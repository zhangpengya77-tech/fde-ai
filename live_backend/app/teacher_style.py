from __future__ import annotations

from dataclasses import dataclass
import re


_OPENCC = None


def _opencc_converter():
    """延後建立 OpenCC 轉換器（簡體→繁體字形），只建一次；套件不存在時回傳 None。
    用 s2tw 只轉字形：s2twp 會把「通過」改成「透過」、「參數」改成「引數」，改錯意思。"""
    global _OPENCC
    if _OPENCC is None:
        try:
            import opencc
            _OPENCC = opencc.OpenCC("s2tw")
        except Exception:  # noqa: BLE001 - 沒有 OpenCC 時退回內建對照表即可
            _OPENCC = False
    return _OPENCC or None


@dataclass(frozen=True)
class TeacherPersonaConfig:
    preferred_language: str = "zh-TW"
    sentence_length: str = "short"
    explanation_style: str = "step-by-step"
    encouragement: str = "light"
    humor: str = "off"
    history_limit: int = 20


class TeacherStyleLayer:
    _traditional = str.maketrans({
        "准": "準", "进": "進", "后": "後", "这": "這", "个": "個",
        "学": "學", "师": "師", "现": "現", "场": "場", "开": "開",
        "电": "電", "飞": "飛", "机": "機", "认": "認", "确": "確",
        "与": "與", "为": "為", "时": "時", "应": "應", "将": "將",
        "马": "馬", "达": "達", "备": "備", "区": "區", "识": "識",
        "项": "項", "当": "當", "摄": "攝", "头": "頭", "请": "請",
        "续": "續", "检": "檢", "线": "線", "号": "號", "转": "轉",
        "换": "換", "输": "輸", "动": "動", "实": "實", "验": "驗",
        "仅": "僅", "断": "斷", "问": "問", "题": "題", "说": "說",
        "发": "發", "声": "聲", "网": "網", "络": "絡", "过": "過",
        "态": "態", "开": "開", "关": "關", "门": "門", "见": "見",
        "习": "習", "导": "導", "终": "終", "毕": "畢", "种": "種",
    })

    def __init__(self, persona: TeacherPersonaConfig | None = None):
        self.persona = persona or TeacherPersonaConfig()

    @classmethod
    def _traditional_text(cls, value: str) -> str:
        # 2026-11-04：改用 OpenCC 完整簡轉繁（台灣用詞）；未安裝時退回內建對照表
        text = str(value or "")
        converter = _opencc_converter()
        return converter.convert(text) if converter else text.translate(cls._traditional)

    @staticmethod
    def _sentences(value: str) -> list[str]:
        return [item.strip(" \n。") for item in re.split(r"[。！？!?\n]+", value) if item.strip()]

    @staticmethod
    def _short_lines(sentence: str, limit: int = 35) -> list[str]:
        """把長句切成不超過 limit 字的行：先在逗號、頓號等標點處斷開，
        單段仍太長時平均切開，避免出現「明。」這種只剩一兩個字的殘句（2026-11-04 修正）。"""
        if len(sentence) <= limit:
            return [sentence]
        pieces = [piece for piece in re.split(r"(?<=[，、；：,;:])", sentence) if piece]
        lines: list[str] = []
        current = ""
        for piece in pieces:
            if len(piece) > limit:
                if current:
                    lines.append(current)
                    current = ""
                parts = -(-len(piece) // limit)  # 無條件進位：需要幾行
                size = -(-len(piece) // parts)   # 平均每行字數
                lines.extend(piece[index:index + size] for index in range(0, len(piece), size))
            elif len(current) + len(piece) <= limit:
                current += piece
            else:
                lines.append(current)
                current = piece
        if current:
            lines.append(current)
        # 保留行尾逗號：同一句話換行時用「，」接續，不會被加上「。」切成好幾句
        return [line for line in lines if line.strip()]

    def apply(self, answer: str, *, next_action: str | None = None, needs_teacher: bool = False) -> str:
        source = self._traditional_text(answer)
        action = self._traditional_text(next_action or "").strip().rstrip("。")
        if needs_teacher:
            action = "請教師現場確認這一步"
        lines: list[str] = []
        if action:
            lines.append(action if action.startswith("先") else f"先{action}")
        for sentence in self._sentences(source):
            if sentence == action or sentence == f"先{action}":
                continue
            lines.extend(self._short_lines(sentence))
            # 2026-11-04：4 行會把「斷電後再更換」這類關鍵提醒截掉，放寬到 6 行（每行仍 ≤36 字）
            if len(lines) >= 6:
                break
        if not any("下一步" in line for line in lines):
            lines.append("下一步：完成後告訴我")
        # 行尾是逗號類標點代表句子還沒結束，不補句號
        return "\n".join(line if line[-1] in "，、；：,;:" else f"{line.rstrip('。')}。" for line in lines if line)
