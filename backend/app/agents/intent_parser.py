from __future__ import annotations

import re

from app.agents.contracts import HouseDesignIntentPatch

_CHINESE_NUMBERS = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4}
_ENGLISH_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4}


def parse_design_intent(message: str) -> HouseDesignIntentPatch:
    """Extract only explicitly stated House Generator parameters; never infer compliance."""
    text = message.casefold()
    patch: dict[str, object] = {}

    storeys_match = re.search(r"(\d+)\s*(?:层|storeys?|stories?|floors?)", text)
    if storeys_match:
        patch["storeys"] = int(storeys_match.group(1))
    else:
        for word, number in _ENGLISH_NUMBERS.items():
            if re.search(r"\b" + word + r"\s+(?:storeys?|stories?|floors?)\b", text):
                patch["storeys"] = number
                break
        if "storeys" not in patch:
            for word, number in _CHINESE_NUMBERS.items():
                if re.search(word + r"\s*层", text):
                    patch["storeys"] = number
                    break

    bedroom_match = re.search(r"(\d+)\s*(?:间)?\s*(?:卧室|bedrooms?|beds)", text)
    if bedroom_match:
        patch["bedrooms"] = int(bedroom_match.group(1))
    else:
        for word, number in _ENGLISH_NUMBERS.items():
            if re.search(r"\b" + word + r"\s+bedrooms?\b", text):
                patch["bedrooms"] = number
                break
        if "bedrooms" not in patch:
            for word, number in _CHINESE_NUMBERS.items():
                if re.search(word + r"\s*(?:间)?\s*卧室", text):
                    patch["bedrooms"] = number
                    break

    area_match = re.search(
        r"(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm|square\s+met(?:re|er)s?|平方米|平米)",
        text,
    )
    if not area_match:
        area_match = re.search(
            r"(?:gfa|gross\s+floor\s+area|target\s+area|总建筑面积|建筑面积)\s*(?:target|of|[:=：为约\s])*\s*(\d+(?:\.\d+)?)",
            text,
        )
    if area_match:
        patch["gross_floor_area_target_m2"] = float(area_match.group(1))

    if any(term in text for term in ("不要车库", "无车库", "no garage", "without a garage")):
        patch["garage"] = "No garage"
    elif any(term in text for term in ("双车库", "双车位车库", "double garage", "two-car garage", "2-car garage")):
        patch["garage"] = "Double garage"
    elif any(term in text for term in ("单车库", "single garage", "one-car garage", "1-car garage")):
        patch["garage"] = "Single garage"
    elif "carport" in text or "车棚" in text:
        patch["garage"] = "Carport"

    if any(term in text for term in ("双坡屋顶", "双坡顶", "双坡形式", "双坡", "gable roof", "gable-roof")):
        patch["roof"] = "Gable roof"
    elif any(term in text for term in ("四坡屋顶", "hip roof", "hipped roof")):
        patch["roof"] = "Hip roof"
    elif any(term in text for term in ("平屋顶", "flat roof")):
        patch["roof"] = "Flat roof"
    elif any(term in text for term in ("单坡屋顶", "mono-pitch", "monopitch", "shed roof", "单坡顶")):
        patch["roof"] = "Mono-pitch roof"
    elif any(term in text for term in ("混合屋顶", "mixed roof")):
        patch["roof"] = "Mixed roof"

    style_terms = (
        ("scandinavian", "Scandinavian"),
        ("北欧", "Scandinavian"),
        ("contemporary", "Contemporary"),
        ("当代", "Contemporary"),
        ("modern", "Modern"),
        ("现代", "Modern"),
        ("traditional", "Traditional"),
        ("传统", "Traditional"),
        ("minimalist", "Minimalist"),
        ("极简", "Minimalist"),
        ("coastal", "Coastal"),
        ("海岸", "Coastal"),
    )
    for term, style in style_terms:
        if term in text:
            patch["style"] = style
            break

    if re.search(r"no\s+split[- ]?level|without\s+(?:a\s+)?split[- ]?level|不要错层|不需要错层|无错层|楼板对齐", text):
        patch["terrain_adaptation"] = "Level pad"
    elif any(term in text for term in ("stepped floor plates", "split-level", "split level", "错层")):
        patch["terrain_adaptation"] = "Stepped floor plates"
    elif any(term in text for term in ("adapt to terrain", "follow the terrain", "顺应地形", "适应地形")):
        patch["terrain_adaptation"] = "Adapt to terrain"
    elif any(term in text for term in ("level pad", "统一标高", "同一标高", "平整平台")):
        patch["terrain_adaptation"] = "Level pad"

    return HouseDesignIntentPatch.model_validate(patch)
