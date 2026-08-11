"""약관 원문 파싱의 최소 골격.

이 모듈은 원문 텍스트를 읽는 일까지만 담당한다. 추출 결과를 ConditionCard의
EvidenceSpan으로 바꾸는 정책은 HTML 근거 좌표 방식이 합의된 뒤 추가한다.
"""

from dataclasses import dataclass
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import re
from typing import Literal

from pypdf import PdfReader


_HTML_ROW_BOUNDARY = "\x1e"
_HTML_CELL_BOUNDARY = "\x1f"
_HTML_PARAGRAPH_BOUNDARY = "\x1d"
_HTML_STRUCTURAL_SENTINELS = {
    _HTML_ROW_BOUNDARY,
    _HTML_CELL_BOUNDARY,
    _HTML_PARAGRAPH_BOUNDARY,
}


@dataclass(frozen=True)
class ParsedUnit:
    locator: str
    text: str


@dataclass(frozen=True)
class ParsedDocument:
    source_type: Literal["html", "text", "pdf"]
    units: tuple[ParsedUnit, ...]
    table_count: int = 0
    flattened_sha256: str | None = None


class _HTMLTextParser(HTMLParser):
    """HTML 본문과 표의 존재 여부만 확인하는 Day 1용 파서."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.table_count = 0
        self._ignored_depth = 0
        self._table_cell_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style"}:
            self._ignored_depth += 1
        elif self._ignored_depth == 0:
            if tag == "table":
                self.table_count += 1
            if tag == "tr":
                self.parts.append(_HTML_ROW_BOUNDARY)
            elif tag in {"th", "td"}:
                self.parts.append(_HTML_CELL_BOUNDARY)
                self._table_cell_depth += 1
            elif tag in {"p", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6"}:
                boundary = " " if self._table_cell_depth else _HTML_PARAGRAPH_BOUNDARY
                self.parts.append(boundary)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)
        elif self._ignored_depth == 0 and tag in {"th", "td"}:
            self._table_cell_depth = max(0, self._table_cell_depth - 1)

    def handle_data(self, data: str) -> None:
        if self._ignored_depth == 0:
            if any(sentinel in data for sentinel in _HTML_STRUCTURAL_SENTINELS):
                raise ValueError("HTML 원문에 예약된 구조 센티널 문자가 포함되어 있습니다")
            self.parts.append(data)


def _normalize_html_text(parts: list[str]) -> str:
    """소스 서식 공백은 접고 HTML 구조에서 나온 행·셀 경계만 보존한다."""

    sentinels = _HTML_STRUCTURAL_SENTINELS
    structural_parts = re.split(
        f"([{''.join(sentinels)}])",
        "".join(parts),
    )
    normalized_parts = [
        part if part in sentinels else " ".join(part.split())
        for part in structural_parts
    ]
    structured_text = "".join(normalized_parts)
    structured_text = structured_text.replace(_HTML_PARAGRAPH_BOUNDARY, "\n")
    structured_text = structured_text.replace(_HTML_ROW_BOUNDARY, "\n")
    structured_text = structured_text.replace(_HTML_CELL_BOUNDARY, "\t")

    lines: list[str] = []
    for raw_line in structured_text.splitlines():
        cells = [cell.strip() for cell in raw_line.split("\t")]
        non_empty_cells = [cell for cell in cells if cell]
        if non_empty_cells:
            lines.append("\t".join(non_empty_cells))
    return "\n".join(lines)


def flattened_text_sha256(text: str) -> str:
    """문자 좌표의 기준이 되는 평탄화 텍스트를 UTF-8로 해시한다."""

    return sha256(text.encode("utf-8")).hexdigest()


def _normalize_pdf_text(text: str) -> str:
    """pypdf 페이지 텍스트의 행은 유지하면서 행 내부 공백만 접는다."""

    lines = [" ".join(line.split()) for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def parse_html(path: Path) -> ParsedDocument:
    parser = _HTMLTextParser()
    parser.feed(path.read_text(encoding="utf-8"))
    text = _normalize_html_text(parser.parts)
    return ParsedDocument(
        source_type="html",
        units=(ParsedUnit(locator="document", text=text),),
        table_count=parser.table_count,
        flattened_sha256=flattened_text_sha256(text),
    )


def parse_pdf_text(path: Path) -> ParsedDocument:
    """PDF를 pypdf 텍스트로 평탄화해 char_location 입력을 만든다."""

    pages = [_normalize_pdf_text(page.extract_text() or "") for page in PdfReader(path).pages]
    text = "\n\f\n".join(pages)
    return ParsedDocument(
        source_type="text",
        units=(ParsedUnit(locator="document", text=text),),
        flattened_sha256=flattened_text_sha256(text),
    )


def parse_document(path: Path) -> ParsedDocument:
    if path.suffix.lower() in {".htm", ".html"}:
        return parse_html(path)
    if path.suffix.lower() == ".pdf":
        return parse_pdf_text(path)
    raise ValueError(f"지원하지 않는 문서 형식: {path.suffix}")
