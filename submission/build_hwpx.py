# -*- coding: utf-8 -*-
"""원본 양식 + 붙여넣기 원고 -> 채운 hwpx (들여쓰기 + 표까지).

들여쓰기를 **선행 공백이 아니라 문단 속성**으로 준다. 양식이 이미 단계를 갖고 있다.
    공백 0칸 -> paraPr 0 (left 0)    1~3칸 -> 2 (2000)    4칸 이상 -> 3 (4000)

⚠ 4칸 이상 묶음은 **칸 맞춤**이라 공통 들여쓰기만 벗기고 안쪽 정렬은 남긴다.
  전부 벗기면 "우리 상한   4,194,304" 의 열이 무너진다.

⚠ linesegarray 는 넣지 않는다 — 레이아웃 캐시라 한글이 열 때 다시 계산한다.
  넣었다가 절마다 vertpos 를 1600 부터 다시 매겨 문단이 겹쳤다(2026-09-02).
"""
import zipfile, io, os, html

TAB, WIDTH = chr(9), 43768
HEAD_FILL, BODY_FILL, ROW_H, CHAR = 3, 6, 1200, 16


def esc(s):
    return html.escape(s, quote=False)


def para(text, ppr):
    o = ('<hp:p id="0" paraPrIDRef="%d" styleIDRef="0" pageBreak="0" columnBreak="0" '
         'merged="0"><hp:run charPrIDRef="%d">' % (ppr, CHAR))
    if not text:
        return o + '</hp:run></hp:p>'
    cells = text.split(TAB)
    body = esc(cells[0])
    for c in cells[1:]:
        body += '<hp:tab width="1000" leader="0" type="1"/>' + esc(c)
    return o + '<hp:t>' + body + '</hp:t></hp:run></hp:p>'


def tbl(rows, tid):
    ncol = max(len(r) for r in rows)
    rows = [r + [''] * (ncol - len(r)) for r in rows]
    span = [max(len(r[c]) for r in rows) or 1 for c in range(ncol)]
    lo = WIDTH * 0.12
    raw = [max(lo, WIDTH * s / sum(span)) for s in span]
    w = [int(v * WIDTH / sum(raw)) for v in raw]
    w[-1] += WIDTH - sum(w)
    out = ['<hp:tbl id="%d" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" '
           'textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" '
           'rowCnt="%d" colCnt="%d" cellSpacing="0" borderFillIDRef="%d" noAdjust="0">'
           % (tid, len(rows), ncol, BODY_FILL),
           '<hp:sz width="%d" widthRelTo="ABSOLUTE" height="%d" heightRelTo="ABSOLUTE" protect="0"/>'
           % (WIDTH, ROW_H * len(rows)),
           '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
           'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" '
           'vertOffset="0" horzOffset="0"/>',
           '<hp:outMargin left="0" right="0" top="140" bottom="140"/>',
           '<hp:inMargin left="510" right="510" top="141" bottom="141"/>']
    for r, row in enumerate(rows):
        out.append('<hp:tr>')
        for c, t in enumerate(row):
            out.append(
                '<hp:tc name="" header="%d" hasMargin="0" protect="0" editable="0" dirty="0" '
                'borderFillIDRef="%d"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" '
                'vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" '
                'textHeight="0" hasTextRef="0" hasNumRef="0">'
                '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" '
                'merged="0"><hp:run charPrIDRef="%d">%s</hp:run></hp:p></hp:subList>'
                '<hp:cellAddr colAddr="%d" rowAddr="%d"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
                '<hp:cellSz width="%d" height="%d"/>'
                '<hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>'
                % (1 if r == 0 else 0, HEAD_FILL if r == 0 else BODY_FILL, CHAR,
                   ('<hp:t>%s</hp:t>' % esc(t)) if t else '', c, r, w[c], ROW_H))
        out.append('</hp:tr>')
    out.append('</hp:tbl>')
    return ('<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" '
            'merged="0"><hp:run charPrIDRef="%d">%s</hp:run></hp:p>' % (CHAR, ''.join(out)))


def indent_of(line):
    return len(line) - len(line.lstrip(' '))


def render(lines, tid):
    out, i, made = [], 0, 0
    while i < len(lines):
        ln = lines[i]
        if TAB in ln:
            j = i
            while j < len(lines) and TAB in lines[j]:
                j += 1
            if j - i >= 2:
                out.append(tbl([l.split(TAB) for l in lines[i:j]], tid + made))
                made += 1
                i = j
                continue
        if ln.strip() and indent_of(ln) >= 4:
            j = i
            while j < len(lines) and (not lines[j].strip() or indent_of(lines[j]) >= 4):
                j += 1
            while j > i and not lines[j - 1].strip():
                j -= 1
            blk = lines[i:j]
            base = min(indent_of(l) for l in blk if l.strip())
            out += [para(l[base:] if l.strip() else '', 3) for l in blk]
            i = j
            continue
        d = indent_of(ln)
        out.append(para(ln.strip() if d else ln, 2 if 1 <= d <= 3 else 0))
        i += 1
    return ''.join(out), made


def build(form, anchors, out_path, tid0=1500000000):
    zin = zipfile.ZipFile(form)
    items = [(i, zin.read(i.filename)) for i in zin.infolist()]
    zin.close()
    result, tables = [], 0
    for info, data in items:
        if info.filename == 'Contents/section0.xml':
            x = data.decode('utf-8')
            # 앵커는 **문단 번호**다. 텍스트로 찾다가 «·» 같은 글자 차이로 두 번 헛짚었다.
            spans = [(m.start(), m.end()) for m in
                     __import__('re').finditer(r'<hp:p\b.*?</hp:p>', x, __import__('re').S)]
            for anchor, src in reversed(anchors):
                assert isinstance(anchor, int) and anchor < len(spans), (form, anchor)
                end = spans[anchor][1]
                lines = [l for l in io.open('submission/paste/' + src, encoding='utf-8')
                         .read().splitlines() if not l.startswith('[표]')]
                while lines and not lines[0].strip():
                    lines.pop(0)
                blk, n = render([''] + lines, tid0 + tables)
                tables += n
                x = x[:end] + blk + x[end:]
            # §7 은 «(자유타이틀 기재)» 다 — 그 **자리를 바꾸는** 것이지 제목을 하나 더
            # 붙이는 게 아니다. 처음에 본문에도 제목을 넣어 "7." 이 둘이 됐다.
            free = '<hp:t>7. (자유타이틀 기재)</hp:t>'
            if free in x:
                x = x.replace(free, '<hp:t>7. 검증 방법과 한계</hp:t>')
            for old, new in [('등록된 팀명과 동일하게 작성', '마진가드'),
                             ('팀장, 팀원 순으로 작성', '박재현(팀장) · 김재현 · 서승기 · 이예찬')]:
                t = '<hp:t>%s</hp:t>' % esc(old)
                assert x.count(t) == 1, old
                x = x.replace(t, '<hp:t>%s</hp:t>' % esc(new))
            data = x.encode('utf-8')
        result.append((info, data))
    with zipfile.ZipFile(out_path, 'w') as z:
        for info, data in result:
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zi.create_system = info.create_system
            z.writestr(zi, data)
    return tables


A1 = [(9, '첨부1-1.txt'), (11, '첨부1-2.txt'), (15, '첨부1-3.txt'),
      (17, '첨부1-4.txt'), (20, '첨부1-5.txt'), (25, '첨부1-6.txt'), (29, '첨부1-7.txt')]

A2 = [(10, '첨부2-1.txt'), (13, '첨부2-2.txt'), (16, '첨부2-3.txt'),
      (20, '첨부2-4.txt'), (25, '첨부2-5.txt')]

FORMS = (('첨부1', A1), ('첨부2', A2))


def build_all(out_dir):
    """두 양식을 out_dir 에 생성하고 {태그: 표 개수} 를 낸다."""
    made = {}
    for tag, anchors in FORMS:
        name = [n for n in os.listdir('data/forms') if n.startswith('(%s)' % tag)][0]
        made[tag] = build(os.path.join('data', 'forms', name),
                          anchors, os.path.join(out_dir, name))
    return made


if __name__ == '__main__':
    for tag, n in build_all(os.path.join('submission', 'filled')).items():
        print('  %s  표 %d개' % (tag, n))
