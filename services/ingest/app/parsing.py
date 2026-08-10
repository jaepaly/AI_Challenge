"""약관 원문 파싱의 최소 골격.

이 모듈은 원문 텍스트를 읽는 일까지만 담당한다. 추출 결과를 ConditionCard의
EvidenceSpan으로 바꾸는 정책은 HTML 근거 좌표 방식이 합의된 뒤 추가한다.
"""

from dataclasses import dataclass
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class ParsedUnit:
    locator: str
    text: str


@dataclass(frozen=True)
class ParsedDocument:
    source_type: Literal["html", "pdf"]
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

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style"}:
            self._ignored_depth += 1
        elif self._ignored_depth == 0:
            if tag == "table":
                self.table_count += 1
            if tag in {"p", "br", "tr", "li", "h1", "h2", "h3"}:
                self.parts.append("\n")
            elif tag in {"th", "td"}:
                self.parts.append("\t")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)

    def handle_data(self, data: str) -> None:
        if self._ignored_depth == 0:
            self.parts.append(data)


def _normalize_html_text(parts: list[str]) -> str:
    """일반 공백은 접되 표의 행(`\n`)과 셀(`\t`) 경계는 보존한다."""

    lines: list[str] = []
    for raw_line in "".join(parts).splitlines():
        cells = [" ".join(cell.split()) for cell in raw_line.split("\t")]
        non_empty_cells = [cell for cell in cells if cell]
        if non_empty_cells:
            lines.append("\t".join(non_empty_cells))
    return "\n".join(lines)


def flattened_text_sha256(text: str) -> str:
    """문자 좌표의 기준이 되는 평탄화 텍스트를 UTF-8로 해시한다."""

    return sha256(text.encode("utf-8")).hexdigest()


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


def parse_document(path: Path) -> ParsedDocument:
    if path.suffix.lower() in {".htm", ".html"}:
        return parse_html(path)
    if path.suffix.lower() == ".pdf":
        raise NotImplementedError("PDF 페이지 추출은 다음 파싱 스파이크에서 추가")
    raise ValueError(f"지원하지 않는 문서 형식: {path.suffix}")
