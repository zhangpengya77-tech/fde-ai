from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components


ROOT = Path(__file__).parent


def inline_asset(html: str, path: str, tag: str) -> str:
    asset_path = ROOT / path
    content = asset_path.read_text(encoding="utf-8")
    if tag == "style":
        return html.replace(f'<link rel="stylesheet" href="./{path}" />', f"<style>\n{content}\n</style>")
    if tag == "script":
        return html.replace(f'<script src="./{path}"></script>', f"<script>\n{content}\n</script>")
    return html


st.set_page_config(page_title="FDE-AI 無人載具學習控制中心", layout="wide")

page = (ROOT / "index.html").read_text(encoding="utf-8")
page = inline_asset(page, "src/styles.css", "style")
page = inline_asset(page, "src/platform-browser.js", "script")
page = inline_asset(page, "src/app.js", "script")

components.html(page, height=3600, scrolling=True)

