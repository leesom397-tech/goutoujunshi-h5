"""Bind a visible voice to existing records using two ordered text anchors.

Pure matching only. Duration alone is never an identity. Missing, repeated,
out-of-order, or clipped anchors fail closed instead of overwriting a record.
"""
import math
import re


def compact(value):
    return re.sub(r'[^\w\u3400-\u9fff]', '', str(value)).casefold()


def duration(row):
    source = row.get('source') or {}
    value = source.get('durationSeconds')
    if type(value) is int and 1 <= value <= 60:
        return value
    found = re.search(r'(?:语音|Audio)\s*(\d{1,2})', str(source.get('rawMediaLabel') or row.get('text', '')), re.I)
    parsed = int(found.group(1)) if found else None
    return parsed if parsed is not None and 1 <= parsed <= 60 else None


def is_voice(row):
    source = row.get('source') or {}
    return source.get('mediaKind') == 'voice' or source.get('uiClass') == 'mmui::ChatVoiceItemView'


def text_anchors(records, lines):
    """Full-message OCR matches; return only globally unique existing texts."""
    normalized = [compact(row.get('text', '')) if row.get('kind') == 'text' else '' for row in records]
    ordered = sorted(lines, key=lambda line: (line['bbox']['y'], line['bbox']['x']))
    tokens = [compact(line.get('text', '')) for line in ordered]
    anchors = []
    for index, needle in enumerate(normalized):
        if len(needle) < 4 or normalized.count(needle) != 1:
            continue
        matches = []
        for start in range(len(tokens)):
            for end in range(start+1, min(start+9, len(tokens)+1)):
                if ''.join(tokens[start:end]) == needle:
                    matches.append((start, end))
        if len(matches) == 1:
            start, end = matches[0]
            top = ordered[start]['bbox']['y']
            bottom = max(line['bbox']['y']+line['bbox']['height'] for line in ordered[start:end])
            anchors.append({'index': index, 'top': top, 'bottom': bottom, 'localId': records[index]['localId']})
    return sorted(anchors, key=lambda item: item['top'])


def match_voice(records, anchors, candidate):
    """Bind one voice only when it is the whole interval between two anchors.

    Filtering other voices by duration would make a partially visible sequence
    appear unique. Multiple voices require match_voice_sequence instead.
    """
    matches = match_voice_sequence(records, anchors, [candidate])
    return {key: matches[0][key] for key in ('record', 'matchedAnchors')} if len(matches) == 1 else None


def match_voice_sequence(records, anchors, candidates):
    """Bind a complete visible voice sequence between two unique text anchors.

    Every intervening record must be a voice, with the same count, order, side
    and duration as the supplied candidates. Missing/overlapping candidates or
    an unreadable intervening text message invalidate the entire interval.
    Coordinates only establish order; neither duration nor position is an ID.
    """
    if not records or not anchors or not candidates:
        return []
    checked = []
    for anchor in anchors:
        try:
            index = anchor['index']
            top, bottom = float(anchor['top']), float(anchor['bottom'])
            if (type(index) is not int or not 0 <= index < len(records)
                    or not math.isfinite(top) or not math.isfinite(bottom) or bottom <= top
                    or records[index].get('localId') != anchor['localId']):
                return []
        except (KeyError, TypeError, ValueError):
            return []
        checked.append((top, bottom, anchor))
    checked.sort(key=lambda item: item[0])
    if (len({a['index'] for _, _, a in checked}) != len(checked)
            or len({a['localId'] for _, _, a in checked}) != len(checked)
            or any(previous[1] >= current[0] or previous[2]['index'] >= current[2]['index']
                   for previous, current in zip(checked, checked[1:]))):
        return []
    groups = {}
    for candidate in candidates:
        try:
            box = candidate['bubbleBbox']
            top, height = float(box['y']), float(box['height'])
            if not math.isfinite(top) or not math.isfinite(height) or height <= 0:
                return []
            bottom = top + height
        except (KeyError, TypeError, ValueError):
            return []
        # A clipped candidate touching an anchor is never part of a complete
        # interval. Mark every interval it intersects invalid rather than omit it.
        for left, right in zip(checked, checked[1:]):
            if bottom > left[1] and top < right[0]:
                key = (left[2]['index'], right[2]['index'])
                group = groups.setdefault(key, {'anchors': (left[2], right[2]), 'items': [], 'invalid': False})
                if top <= left[1] or bottom >= right[0] or candidate.get('clipped'):
                    group['invalid'] = True
                group['items'].append((top, bottom, candidate))
    matches = []
    for (start, end), group in sorted(groups.items()):
        interval = records[start+1:end]
        def confirmed_image(row):
            source = row.get('source') or {}
            return row.get('kind') == 'image' and (source.get('mediaKind') == 'image' or
                source.get('uiClass') in ('mmui::ChatImageItemView', 'mmui::ChatBubbleReferItemView'))
        if any(not is_voice(row) and not confirmed_image(row) for row in interval):
            continue
        rows = [row for row in interval if is_voice(row)]
        visible = sorted(group['items'], key=lambda item: item[0])
        if (group['invalid'] or not rows or len(rows) != len(visible)
                or any(not is_voice(row) for row in rows)
                or len({row.get('localId') for row in rows}) != len(rows)
                or any(not row.get('localId') for row in rows)
                or any(previous[1] >= current[0] for previous, current in zip(visible, visible[1:]))):
            continue
        if any(type(candidate.get('durationSeconds')) is not int
               or not 1 <= candidate['durationSeconds'] <= 60
               or duration(row) != candidate['durationSeconds']
               or not row.get('senderRole') or row['senderRole'] != candidate.get('side')
               for row, (_, _, candidate) in zip(rows, visible)):
            continue
        left, right = group['anchors']
        matches.extend({'candidate': candidate, 'record': row,
                        'matchedAnchors': [left['localId'], right['localId']]}
                       for row, (_, _, candidate) in zip(rows, visible))
    return matches


def match_adjacent_voice(records, anchors, candidate, bubbles):
    """Two consecutive unique text rows immediately followed by ONE bubble.

    This is only valid for a continuous visible chat viewport. Reject any
    intervening bubble and require a short physical gap after the last anchor.
    """
    box=candidate['bubbleBbox']
    prior=[a for a in anchors if a['bottom']<box['y']]
    if len(prior)<2:return None
    left,right=prior[-2:]
    if right['index']!=left['index']+1 or box['y']-right['bottom']>75:return None
    if any(b['y']>=right['bottom'] and b['y']<box['y'] for b in bubbles):return None
    index=right['index']+1
    if index>=len(records):return None
    row=records[index]
    if not is_voice(row) or row.get('senderRole')!=candidate['side']:return None
    return {'record':row,'matchedAnchors':[left['localId'],right['localId']]}
