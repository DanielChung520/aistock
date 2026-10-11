"""Limited screening-script language: text ⇄ DSL conditions.

Intentionally tiny and safe (no arbitrary code): identifiers are
INDICATOR_CATALOG metrics, comparison operators are >, >=, <, <=, ==, and the
only boolean connector is `and`/`&` — the scan engine ANDs all conditions, so
`or`/`not` are rejected. Assignments name boolean groups; the final
`buy = ...` (or the last expression) is the signal. `weekly(...)` / `m15(...)`
wrap a comparison to set its timeframe.

parse_script() → conditions (then _validate_conditions enforces the catalog);
render_script() → readable script from conditions (for display/AI output).
"""
from __future__ import annotations

import re

from src.strategy import INDICATOR_CATALOG

_METRIC_TYPE = {m["metric"]: m["type"] for m in INDICATOR_CATALOG}
_NUM_OPS = (">", ">=", "<", "<=", "==")
_TF_WRAPPERS = {"weekly": "w", "w": "w", "min15": "15m", "m15": "15m", "tf15": "15m"}
_TF_LABEL = {"w": "weekly", "15m": "m15"}
_NUMBER_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
_TOKEN_RE = re.compile(r"\s*(>=|<=|==|>|<|\(|\)|=|&|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)")


class ScriptError(ValueError):
    pass


def _tokenize(line: str) -> list[str]:
    tokens: list[str] = []
    pos = 0
    while pos < len(line):
        match = _TOKEN_RE.match(line, pos)
        if not match:
            raise ScriptError(f"無法解析的字元：{line[pos:pos + 10]!r}")
        tokens.append(match.group(1))
        pos = match.end()
    return tokens


def _render_condition(cond: dict) -> str:
    metric = cond["metric"]
    op = cond["op"]
    if op == "is_true":
        expr = metric
    else:
        expr = f"{metric} {op} {cond.get('value')}"
    tf = cond.get("tf")
    if tf in _TF_LABEL:
        return f"{_TF_LABEL[tf]}({expr})"
    return expr


def render_script(conditions: list[dict]) -> str:
    parts = [_render_condition(c) for c in conditions]
    body = " and ".join(parts) if parts else "False"
    return f"buy = {body}"


def _operand(token: str):
    if _NUMBER_RE.match(token):
        return float(token) if "." in token else int(token)
    if token in _METRIC_TYPE and _METRIC_TYPE[token] == "num":
        return token
    raise ScriptError(f"運算元必須是數字或數值指標：{token}")


class _Parser:
    def __init__(self, tokens: list[str], groups: dict[str, list[dict]]):
        self.tokens = tokens
        self.pos = 0
        self.groups = groups

    def _peek(self) -> str | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def _next(self) -> str | None:
        token = self._peek()
        self.pos += 1
        return token

    def parse_expr(self, tf: str | None) -> list[dict]:
        conds = self._parse_term(tf)
        while self._peek() in ("&", "and"):
            self._next()
            conds = conds + self._parse_term(tf)
        return conds

    def _parse_term(self, tf: str | None) -> list[dict]:
        token = self._peek()
        if token == "(":
            self._next()
            inner = self.parse_expr(tf)
            if self._next() != ")":
                raise ScriptError("括號未閉合")
            return inner
        if token in _TF_WRAPPERS:
            self._next()
            if self._next() != "(":
                raise ScriptError(f"{token} 需搭配括號，例如 {token}(ma8 > ma21)")
            inner = self.parse_expr(_TF_WRAPPERS[token])
            if self._next() != ")":
                raise ScriptError(f"{token}(...) 括號未閉合")
            return inner
        return self._parse_atom(tf)

    def _parse_atom(self, tf: str | None) -> list[dict]:
        left = self._next()
        if left is None:
            raise ScriptError("運算式不完整")
        if left not in _METRIC_TYPE and left not in self.groups:
            raise ScriptError(f"未知的指標或群組：{left}")
        nxt = self._peek()
        if nxt in _NUM_OPS:
            if left not in _METRIC_TYPE:
                raise ScriptError(f"{left} 不是指標，不能用於比較")
            op = self._next()
            value = _operand(self._next())
            cond: dict = {"metric": left, "op": op, "value": value}
            if tf:
                cond["tf"] = tf
            cond["note"] = _render_condition(cond)
            return [cond]
        if left in self.groups:
            group = [dict(c) for c in self.groups[left]]
            if tf:
                for c in group:
                    c["tf"] = tf
                    c["note"] = _render_condition(c)
            return group
        if _METRIC_TYPE[left] != "bool":
            raise ScriptError(f"{left} 是數值指標，需搭配運算子（例如 {left} > 0）")
        cond = {"metric": left, "op": "is_true", "value": None, "note": left}
        if tf:
            cond["tf"] = tf
            cond["note"] = _render_condition(cond)
        return [cond]


def _parse_line(tokens: list[str], groups: dict[str, list[dict]]) -> tuple[str | None, list[dict]]:
    if len(tokens) >= 2 and tokens[1] == "=" and tokens[0] not in _NUM_OPS and tokens[0] != "(":
        name = tokens[0]
        expr_tokens = tokens[2:]
    else:
        name = None
        expr_tokens = tokens
    if not expr_tokens:
        raise ScriptError("等號右側為空")
    parser = _Parser(expr_tokens, groups)
    conds = parser.parse_expr(None)
    if parser.pos != len(expr_tokens):
        raise ScriptError(f"無法解析的語法：{expr_tokens[parser.pos:]}")
    return name, conds


def parse_script(script: str) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    signal: list[dict] | None = None
    last: list[dict] | None = None
    for raw in script.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        name, conds = _parse_line(_tokenize(line), groups)
        if name is None:
            signal = conds
            last = conds
        else:
            groups[name] = conds
            last = conds
            if name == "buy":
                signal = conds
    if signal is None:
        signal = last
    if signal is None:
        raise ScriptError("腳本為空")
    return signal
