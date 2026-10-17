"""Bounded enrichment of an already verified, visible conversation.

Caller provides existing records and a reference image of the confirmed contact.
No contact search, account discovery, audio playback or message sending. This
fallback is currently restricted to self green bubbles in the dark desktop UI.
"""
import time
from collections import deque
from voice_context import text_anchors, match_voice_sequence, is_voice
from voice_candidates import detect_self_voice_candidates
from voice_ocr import parse_voice_transcript
from voice_transcript import parse_voice_transcript as parse_voice_header
from voice_menu_ui import NativeVoiceMenu
from native_transcript import copy_transcript
from voice_frame_identity import capture_frame_identity, frame_identity_matches


def transcript_region(image, bubble, chat_region):
    """Find the fully visible dark transcript bubble directly below a voice."""
    x,y,w,h=chat_region
    right=int(bubble['x']+bubble['width'])
    bottom=int(bubble['y']+bubble['height'])
    px=image.convert('RGB');pixels=px.load()
    def gray(a,b):
        r,g,blue=pixels[a,b]
        return 40 <= r <= 65 and max(r,g,blue)-min(r,g,blue)<=3
    seed=None
    for yy in range(bottom+3,min(bottom+15,y+h-1)):
        if gray(right-20,yy):seed=(right-20,yy);break
    if seed is None:return None
    seen={seed};queue=deque([seed]);left=rr=seed[0];top=bb=seed[1]
    while queue:
        a,b=queue.popleft();left=min(left,a);rr=max(rr,a);top=min(top,b);bb=max(bb,b)
        for aa,bbb in ((a-1,b),(a+1,b),(a,b-1),(a,b+1)):
            if x<aa<x+w-1 and y<bbb<y+h-1 and (aa,bbb) not in seen and gray(aa,bbb):
                seen.add((aa,bbb));queue.append((aa,bbb))
        if len(seen)>200000:return None
    if min(left-x,top-y,x+w-1-rr,y+h-1-bb)<=2:return None
    if bb-top<28 or rr-left<50 or abs(rr-(right-7))>15:return None
    return (left,top,rr+1,bb+1)


def enrich_visible(window, records, reference, *, title_region, chat_region,
                   seconds=25, max_scrolls=8, progress=None, on_update=None, observe=None):
    """Enrich uniquely anchored sources; return progress even at the time limit.

    Must be invoked only after the caller verifies the reference belongs to the
    chosen account/contact library. No foreground activation is done here.
    """
    from PIL import ImageChops
    from local_vision import recognize_image, recognize_duration
    from local_ocr import recognize_image as recognize_transcript_image
    from pywinauto import mouse
    import win32gui,win32process
    if not 1<=seconds<=120 or not 0<=max_scrolls<=30:raise ValueError('Invalid batch limit')
    deadline=time.monotonic()+seconds
    rect=window.rectangle();original_rect=(rect.left,rect.top,rect.right,rect.bottom)
    x,y,w,h=chat_region
    if min(x,y)<0 or x+w>reference.width or y+h>reference.height:raise ValueError('Invalid chat region')
    updates=[];attempted={};scrolls=0;unchanged=0;outcomes=[];repositions=0
    located_cache=None
    def guard():
        foreground=win32gui.GetForegroundWindow()
        if not foreground or win32process.GetWindowThreadProcessId(foreground)[1]!=window.process_id():
            raise RuntimeError('FOREGROUND_CHANGED')
        if not window.is_visible() or win32gui.IsIconic(window.handle):
            raise RuntimeError('WINDOW_NOT_VISIBLE')
        r=window.rectangle()
        if (r.left,r.top,r.right,r.bottom)!=original_rect:raise RuntimeError('WINDOW_CHANGED')
        image=window.capture_as_image()
        if ImageChops.difference(image.crop(title_region),reference.crop(title_region)).getbbox():
            raise RuntimeError('CONTACT_CHANGED')
        return image
    def budget():
        remaining=deadline-time.monotonic()
        if remaining<=.2:raise RuntimeError('batch-limit')
        return min(10,remaining)
    def locate(image):
        nonlocal located_cache
        frame=image.crop((x,y,x+w,y+h)).convert('RGB').tobytes()
        if located_cache is not None and located_cache[0]==frame:
            return located_cache[1]
        ocr=recognize_image(image.crop((x,y,x+w,y+h)),timeout=budget())
        for line in ocr['lines']:
            line['bbox']['x']+=x;line['bbox']['y']+=y
        anchors=text_anchors(records,ocr['lines'])
        found=detect_self_voice_candidates(image,{'x':x,'y':y,'width':w,'height':h},
            recognize=lambda image,**kw:recognize_image(image,timeout=budget(),**kw),
            recognize_duration=lambda image:recognize_duration(image,timeout=budget()))
        matches=[(match['candidate'],{key:match[key] for key in ('record','matchedAnchors')})
                 for match in match_voice_sequence(records,anchors,found['candidates'])]
        for candidate,match in matches:
            anchor=next(a for a in anchors if a['localId']==match['matchedAnchors'][0])
            match['frameIdentity']=capture_frame_identity(image,chat_region=chat_region,
                bubble=candidate['bubbleBbox'],anchor=anchor,source_id=match['record']['localId'],matched_anchors=match['matchedAnchors'])
        # A source cannot occupy two bubbles in the same frame.
        matches=[(c,m) for c,m in matches if sum(n['record']['localId']==m['record']['localId'] for _,n in matches)==1]
        located_cache=(frame,matches)
        return matches
    def box_tuple(box):
        return (box['x'],box['y'],box['x']+box['width'],box['y']+box['height'])
    def unchanged_region(before, region):
        current=guard()
        if ImageChops.difference(before.crop(region),current.crop(region)).getbbox():
            raise RuntimeError('SOURCE_MOVED')
        return current
    try:
        while time.monotonic()<deadline:
            image=guard()
            candidate=None
            for detected,matched in locate(image):
                if attempted.get(matched['record']['localId'],0)<2 and matched['record'].get('source',{}).get('transcriptionStatus')!='visible-text':
                    candidate=(detected,matched);break
            if candidate:
                detected,matched=candidate;box=detected['bubbleBbox'];row=matched['record']
                if box['y']>y+h*.55 and repositions<8:
                    unchanged_region(image,(x,y,x+w,y+h))
                    mouse.scroll(coords=(rect.left+x+w-30,rect.top+y+h-40),wheel_dist=-1)
                    repositions+=1;time.sleep(.4);continue
                attempted[row['localId']]=attempted.get(row['localId'],0)+1
                repositions=0
                unchanged_region(image,(x,y,x+w,y+h))
                if transcript_region(image,box,chat_region) is None:
                    native=NativeVoiceMenu(window,guard,timeout=budget(),observe=observe)
                    menu=native.convert(box)
                    if menu.get('action')!='conversion-requested':
                        outcomes.append(menu.get('reason','menu-unreadable'));continue
                copied=None;result_deadline=min(deadline,time.monotonic()+15)
                while time.monotonic()<result_deadline:
                    time.sleep(.4);after=guard()
                    # Do not reuse coordinates after Weixin moves the source.
                    if ImageChops.difference(image.crop(box_tuple(box)),after.crop(box_tuple(box))).getbbox():
                        fresh=[(c,m) for c,m in locate(after) if m['record']['localId']==row['localId']]
                        if len(fresh)!=1:outcomes.append('source-moved');break
                        detected,matched=fresh[0];box=detected['bubbleBbox'];image=after
                    body=transcript_region(after,box,chat_region)
                    if body is None:continue
                    time.sleep(.4)
                    stable=guard()
                    if ImageChops.difference(after.crop(body),stable.crop(body)).getbbox():continue
                    parsed=parse_voice_transcript(recognize_transcript_image(stable.crop(body),scale=2,timeout=budget()))
                    if parsed['status']!='ready':continue
                    if not frame_identity_matches(matched['frameIdentity'],stable,source_id=row['localId'],bubble=box):
                        current=[(c,m) for c,m in locate(stable) if m['record']['localId']==row['localId']]
                        if len(current)!=1:outcomes.append('source-not-reconfirmed');break
                        if current[0][0]['bubbleBbox']!=box:outcomes.append('source-moved');break
                        matched=current[0][1]
                    def verify_body():
                        unchanged_region(stable,body)
                        unchanged_region(stable,box_tuple(box))
                    native=NativeVoiceMenu(window,guard,timeout=budget(),action='copy-transcript',observe=observe)
                    copied=copy_transcript(native,{'x':body[0],'y':body[1],'width':body[2]-body[0],'height':body[3]-body[1]},
                        process_id=window.process_id(),verify=verify_body,visible_text=parsed['text'])
                    break
                if not copied or copied['status']!='ready':
                    reason=copied.get('reason','native-body-timeout') if copied else 'native-body-timeout'
                    outcomes.append({'localId':row['localId'],'reason':reason});continue
                header=parse_voice_header(row['text'],ui_class=row.get('source',{}).get('uiClass'))
                if not header or not header['source'].get('rawMediaLabel'):
                    outcomes.append('source-header-unconfirmed');continue
                update={'localId':row['localId'],'text':copied['text'],'verified':True,
                        'matchedAnchors':matched['matchedAnchors'],
                        'source':{**row.get('source',{}),**header['source'],'transcriptionStatus':'visible-text',
                                  'transcriptionSource':copied['source']}}
                row.update(kind='text',text=copied['text'],source=update['source']);updates.append(update)
                if on_update:on_update(update)
                if progress:progress(len(updates),'已补全语音文字，正在核对下一条')
                continue
            if scrolls>=max_scrolls:break
            before=guard().crop((x,y,x+w,y+h))
            # Qt clamps a large wheel delta to one small movement. Send a few
            # separate ticks, retaining more than half a viewport of overlap.
            for _ in range(min(6,max(1,h//225))):
                guard()
                mouse.scroll(coords=(rect.left+x+w-30,rect.top+y+h-40),wheel_dist=1)
                time.sleep(.15)
            time.sleep(.4);after=guard().crop((x,y,x+w,y+h))
            unchanged=unchanged+1 if ImageChops.difference(before,after).getbbox() is None else 0
            scrolls+=1
            if unchanged>=3:
                outcomes.append('viewport-not-moving');break
        complete=not any(is_voice(row) and row.get('source',{}).get('transcriptionStatus')!='visible-text' for row in records)
        return {'updates':updates,'attempted':len(attempted),'scrolls':scrolls,'outcomes':outcomes,'complete':complete,
                'reason':'batch-limit' if time.monotonic()>=deadline else 'no-unique-visible-source'}
    except Exception as error:
        # Preserve completed updates on OCR errors, focus changes and timeouts.
        reason=str(error) if isinstance(error,RuntimeError) else 'capture-interrupted'
        return {'updates':updates,'attempted':len(attempted),'scrolls':scrolls,'outcomes':outcomes,'complete':False,'reason':reason}
