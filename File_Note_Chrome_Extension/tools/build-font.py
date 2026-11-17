"""File Note で使うフォント（file-note/fonts/FileNoteSans-Regular.ttf）を作る。

Noto Sans JP（完全版）を土台に、日本語フォントにない文字だけを次のフォントから取り出して 1 つにまとめる。
  Noto Sans（ラテン文字・通貨記号など）→ Noto Sans Symbols 2 / Symbols（✔ ☐ ☑ などの記号）
  → Noto Emoji（白黒の絵文字）→ Noto Sans KR（ハングル）→ Noto Sans SC（簡体字）
1 つのフォントにまとめると、文字の書き込み・PDF内の入力欄・保存したPDFがすべて同じフォントで済み、
日本語と韓国語などが混ざった文でもそのまま扱える。

使い方（fonttools が必要: pip install fonttools）
  python3 tools/build-font.py
元のフォントは Google Fonts のリポジトリ（https://github.com/google/fonts）から取得する。
すべて SIL Open Font License 1.1。
"""
import os
import sys
import urllib.request

from fontTools import subset
from fontTools.merge import Merger, Options
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'file-note', 'fonts', 'FileNoteSans-Regular.ttf')
CACHE = os.path.join(HERE, '.font-cache')
BASE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
BASE = ('notosansjp/NotoSansJP%5Bwght%5D.ttf', 'Noto Sans JP')
# Fallbacks, in order: a character comes from the first font that has it.
FALLBACKS = [
    ('notosans/NotoSans%5Bwdth,wght%5D.ttf', 'Noto Sans'),
    ('notosanssymbols2/NotoSansSymbols2-Regular.ttf', 'Noto Sans Symbols 2'),
    ('notosanssymbols/NotoSansSymbols%5Bwght%5D.ttf', 'Noto Sans Symbols'),
    ('notoemoji/NotoEmoji%5Bwght%5D.ttf', 'Noto Emoji'),
    ('notosanskr/NotoSansKR%5Bwght%5D.ttf', 'Noto Sans KR'),
    ('notosanssc/NotoSansSC%5Bwght%5D.ttf', 'Noto Sans SC'),
]
# Joiners and selectors that emoji sequences need, even though other fonts list some of them.
EMOJI_SEQUENCE_CODES = {0x200D, 0xFE0E, 0xFE0F, 0x20E3} | set(range(0x1F3FB, 0x1F400)) | set(range(0xE0020, 0xE0080))
# Tables that are not merged: vertical metrics and font-variation leftovers the app does not use.
DROP = ['BASE', 'STAT', 'vhea', 'vmtx', 'VORG', 'meta', 'DSIG', 'MVAR', 'HVAR', 'VVAR', 'avar', 'fvar', 'gvar', 'cvar']


def fetch(path):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, os.path.basename(path).replace('%5B', '[').replace('%5D', ']'))
    if not os.path.exists(local):
        print('download', path)
        urllib.request.urlretrieve(BASE_URL + path, local)
    return local


def regular(path):
    font = TTFont(fetch(path))
    if 'fvar' in font:
        axes = {a.axisTag: (400 if a.axisTag == 'wght' else 100 if a.axisTag == 'wdth' else a.defaultValue) for a in font['fvar'].axes}
        font = instancer.instantiateVariableFont(font, axes)
    return font


def prepare(font, name):
    if font['head'].unitsPerEm != 1000:
        scale_upem(font, 1000)
    for tag in DROP:
        if tag in font:
            del font[tag]
    path = os.path.join(CACHE, 'part-' + name.replace(' ', '') + '.ttf')
    font.save(path)
    return path


def main():
    base = regular(BASE[0])
    metrics = {
        'hhea': {k: getattr(base['hhea'], k) for k in ('ascent', 'descent', 'lineGap')},
        'OS/2': {k: getattr(base['OS/2'], k) for k in ('sTypoAscender', 'sTypoDescender', 'sTypoLineGap', 'usWinAscent', 'usWinDescent')},
    }
    copyrights = [base['name'].getDebugName(0)]
    covered = set(base.getBestCmap())
    parts = [prepare(base, BASE[1])]
    for path, name in FALLBACKS:
        font = regular(path)
        if font['name'].getDebugName(0) not in copyrights:
            copyrights.append(font['name'].getDebugName(0))
        codes = set(font.getBestCmap())
        wanted = codes - covered
        if name == 'Noto Emoji':
            wanted |= EMOJI_SEQUENCE_CODES & codes
        wanted -= {0x20, 0xA0}
        options = subset.Options()
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.notdef_outline = True
        options.hinting = False
        sub = subset.Subsetter(options)
        sub.populate(unicodes=wanted)
        sub.subset(font)
        covered |= wanted
        print(f'{name}: {len(wanted)} 文字')
        parts.append(prepare(font, name))

    merged = Merger(options=Options(drop_tables=DROP)).merge(parts)
    # Keep the line metrics of Noto Sans JP, so text and form fields sit where they did before.
    for table, values in metrics.items():
        for key, value in values.items():
            setattr(merged[table], key, value)
    names = merged['name']
    for record in list(names.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17):
            names.removeNames(nameID=record.nameID)
    # A new name for the modified font (OFL). It must not use the Reserved Font Name 'Source' of Noto CJK.
    for nid, text in {1: 'File Note Sans', 2: 'Regular', 3: 'FileNoteSans-Regular', 4: 'File Note Sans Regular', 6: 'FileNoteSans-Regular'}.items():
        names.setName(text, nid, 3, 1, 0x409)
        names.setName(text, nid, 1, 0, 0)
    names.removeNames(nameID=0)
    names.setName(' / '.join(copyrights), 0, 3, 1, 0x409)
    names.setName(
        'Built for File Note from Noto Sans JP, Noto Sans, Noto Sans Symbols 2, Noto Sans Symbols, Noto Emoji, '
        'Noto Sans KR and Noto Sans SC (SIL Open Font License 1.1).',
        10, 3, 1, 0x409,
    )
    merged.save(OUT)
    print(f'{OUT}: {merged["maxp"].numGlyphs} glyphs, {os.path.getsize(OUT):,} bytes')


if __name__ == '__main__':
    sys.exit(main())
