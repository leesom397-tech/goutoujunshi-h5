"""Experimental self-green-bubble candidates only; never operates UI.

Caller must verify the contact and supply ONLY its visible chat rectangle.
Every returned position still requires a unique exact native voice-to-text menu.
A green bubble + duration cannot establish message identity or successful OCR.
"""
from collections import deque
import math
import re

_DURATION = re.compile(r'^(?:[1-9]|[1-5][0-9]|60)["″”]$')
_TEXT = re.compile(r'[A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff]')


def _rect(value, size):
    try:
        x, y, w, h = [float(value[name]) for name in ("x", "y", "width", "height")]
    except (KeyError, TypeError, ValueError):
        raise ValueError("An explicit verified chat_region is required")
    if not all(math.isfinite(v) and v == int(v) for v in (x, y, w, h)) or x < 0 or y < 0 or w <= 0 or h <= 0 or x+w > size[0] or y+h > size[1] or w*h > 2_000_000:
        raise ValueError("The verified chat_region must be inside the input image and at most 2 megapixels")
    return int(x), int(y), int(w), int(h)


def green_bubbles(crop):
    """Color/geometry proposals, not a probability or evidence of a voice."""
    rgb = crop.convert("RGB")
    width, height = rgb.size
    raw = rgb.tobytes()
    mask = bytearray(width*height)
    for index in range(width*height):
        r, g, b = raw[index*3:index*3+3]
        mask[index] = int(g >= 105 and g-r >= 35 and g-b >= 25 and r <= 190)
    boxes = []
    for start in range(len(mask)):
        if not mask[start]:
            continue
        mask[start] = 0
        todo = deque([start])
        left=right=start%width
        top=bottom=start//width
        area=0
        while todo:
            pos=todo.popleft()
            x,y=pos%width,pos//width
            area+=1
            left=min(left,x);right=max(right,x);top=min(top,y);bottom=max(bottom,y)
            adjacent=[]
            if x>0:adjacent.append(pos-1)
            if x+1<width:adjacent.append(pos+1)
            if y>0:adjacent.append(pos-width)
            if y+1<height:adjacent.append(pos+width)
            for nxt in adjacent:
                if mask[nxt]:
                    mask[nxt]=0;todo.append(nxt)
        bw,bh=right-left+1,bottom-top+1
        if 55<=bw<=width*.88 and 24<=bh<=110 and bw>=bh*1.3 and area/(bw*bh)>=.65 and left>1 and top>1 and right<width-2 and bottom<height-2:
            boxes.append({"x":left,"y":top,"width":bw,"height":bh})
    rgb.close()
    return sorted(boxes,key=lambda box:(box["y"],box["x"]))


def detect_self_voice_candidates(image, chat_region, *, recognize=None, max_bubbles=12, recognize_duration=None):
    """Return candidates in original image pixels, with no private text.

    Only self green bubbles are supported. Opponent/gray bubbles are deliberately
    unhandled. No coordinates, seconds or color may be used as message identity.
    """
    from PIL import Image, ImageOps
    if not isinstance(image, Image.Image):
        raise TypeError("image must be the caller-provided PIL image")
    if not isinstance(max_bubbles,int) or not 1<=max_bubbles<=24:
        raise ValueError("max_bubbles must be 1..24")
    if recognize is None:
        from local_ocr import recognize_image
        recognize=recognize_image
    x,y,w,h=_rect(chat_region,image.size)
    crop=image.crop((x,y,x+w,y+h)).convert("RGB")
    bubbles=green_bubbles(crop)
    candidates=[]
    try:
        large=[]
        if bubbles and recognize_duration is None:
            inverted=ImageOps.invert(crop)
            try:
                large=recognize(inverted,scale=2).get("lines",[])
            except Exception:
                pass
            finally:
                inverted.close()
        for bubble in bubbles[:max_bubbles]:
            bx,by,bw,bh=[bubble[key] for key in ("x","y","width","height")]
            bubble_box={"x":x+bx,"y":y+by,"width":bw,"height":bh}

            def parse(lines,ox,oy):
                found=[];other_text=False
                for line in lines:
                    compact=re.sub(r"\s+","",str(line.get("text","")))
                    try:
                        dx,dy,dw,dh=[float(line.get("bbox",{})[key]) for key in ("x","y","width","height")]
                    except (KeyError,TypeError,ValueError):
                        continue
                    if not all(math.isfinite(v) for v in (dx,dy,dw,dh)) or dw<=0 or dh<=0:
                        continue
                    left,top=dx+ox,dy+oy
                    if not (left>=bubble_box["x"] and top>=bubble_box["y"] and left+dw<=bubble_box["x"]+bw and top+dh<=bubble_box["y"]+bh):
                        continue
                    if _DURATION.fullmatch(compact):
                        found.append((int(re.match(r"\d+",compact).group()),{"x":left,"y":top,"width":dw,"height":dh}))
                    elif _TEXT.search(compact):
                        other_text=True
                return found if len(found)==1 and not other_text else []

            choices=parse(large,x,y)
            if not choices:
                # Remove rounded outer corners. Green-channel thresholding
                # separates the dark label from this verified green bubble.
                # Exclude the loudspeaker glyph: Windows OCR can otherwise
                # merge its arcs into the seconds label and return no text.
                label_left=max(10,bw-110)
                label_right=bw-53
                if label_right <= label_left:
                    continue
                source=crop.crop((bx+label_left,by+6,bx+label_right,by+bh-6))
                if recognize_duration is not None:
                    reading=recognize_duration(source)
                    if reading.get('status')=='ready':
                        seconds=reading['durationSeconds']
                        label_box={'x':x+bx+label_left,'y':y+by+6,'width':source.width,'height':source.height}
                        source.close()
                        candidates.append({'status':'candidate','durationSeconds':seconds,'durationBbox':label_box,'bubbleBbox':bubble_box,
                            'point':{'x':label_box['x']+label_box['width']/2,'y':label_box['y']+label_box['height']/2},
                            'requiresNativeMenuVerification':True,'side':'self'})
                        continue
                    # The dedicated model already examined the complete label.
                    # Re-running detection at several scales on ordinary text
                    # bubbles wastes most of a batch without stronger evidence.
                    source.close()
                    continue
                # Preserve the original anti-aliased digits first. Thresholding
                # can merge the seconds quote into a Chinese punctuation mark.
                original=ImageOps.expand(source,border=20,fill='white')
                try:
                    result=recognize(original,scale=3)
                    choices=parse(result.get('lines',[]),x+bx+label_left-20,y+by+6-20)
                except Exception:
                    choices=[]
                finally:
                    original.close()
                if choices:
                    source.close()
                    seconds,label_box=choices[0]
                    candidates.append({'status':'candidate','durationSeconds':seconds,'durationBbox':label_box,'bubbleBbox':bubble_box,
                        'point':{'x':label_box['x']+label_box['width']/2,'y':label_box['y']+label_box['height']/2},
                        'requiresNativeMenuVerification':True,'side':'self'})
                    continue
                binary=source.getchannel("G").point(lambda value:255 if value>=125 else 0)
                padded=Image.new("RGB",(binary.width+40,binary.height+40),"white")
                padded.paste(binary,(20,20))
                source.close();binary.close()
                try:
                    result=recognize(padded,scale=3)
                    choices=parse(result.get("lines",[]),x+bx+label_left-20,y+by+6-20)
                except Exception:
                    choices=[]
                finally:
                    padded.close()
            if len(choices)!=1:
                continue
            seconds,label_box=choices[0]
            candidates.append({"status":"candidate","durationSeconds":seconds,"durationBbox":label_box,"bubbleBbox":bubble_box,
                               "point":{"x":label_box["x"]+label_box["width"]/2,"y":label_box["y"]+label_box["height"]/2},
                               "requiresNativeMenuVerification":True,"side":"self"})
        return {"status":"candidates" if candidates else "no-reliable-candidates","candidates":candidates,
                "checkedBubbles":min(len(bubbles),max_bubbles),"skippedBubbles":min(len(bubbles),max_bubbles)-len(candidates),
                "remainingBubbles":max(0,len(bubbles)-max_bubbles),"scope":"self-green-bubbles-only"}
    finally:
        crop.close()
