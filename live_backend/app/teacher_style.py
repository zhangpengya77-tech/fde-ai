from __future__ import annotations

from dataclasses import dataclass
import re


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
        return str(value or "").translate(cls._traditional)

    @staticmethod
    def _sentences(value: str) -> list[str]:
        return [item.strip(" \n。") for item in re.split(r"[。！？!?\n]+", value) if item.strip()]

    @staticmethod
    def _short_lines(sentence: str, limit: int = 35) -> list[str]:
        return [sentence[index:index + limit] for index in range(0, len(sentence), limit)]

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
            if len(lines) >= 4:
                break
        if not any("下一步" in line for line in lines):
            lines.append("下一步：完成後告訴我")
        return "\n".join(f"{line.rstrip('。')}。" for line in lines if line)
