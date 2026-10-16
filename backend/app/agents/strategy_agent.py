from __future__ import annotations

import re

from app.agents.contracts import HouseDesignChatRequest, HouseDesignIntentPatch

_LABELS = {
    "storeys": "层数",
    "bedrooms": "卧室数",
    "gross_floor_area_target_m2": "目标建筑面积",
    "style": "建筑风格",
    "roof": "屋顶形式",
    "garage": "车库形式",
    "terrain_adaptation": "地形策略",
}


def build_strategy_reply(request: HouseDesignChatRequest, patch: HouseDesignIntentPatch) -> str:
    """Produce a grounded fallback reply from structured fields, without legal conclusions."""
    values = patch.model_dump(exclude_none=True)
    is_chinese = bool(re.search(r"[\u4e00-\u9fff]", request.message))

    if is_chinese:
        if values:
            changes = []
            for key, value in values.items():
                shown = str(value)
                if key == "gross_floor_area_target_m2":
                    shown += " m²"
                elif key == "storeys":
                    shown += " 层"
                elif key == "bedrooms":
                    shown += " 间"
                changes.append(_LABELS.get(key, key) + "：" + shown)
            message = "我已将以下内容解析为结构化设计意图，前端会同步更新对应的 Design inputs：\n" + "；".join(changes) + "。"
        else:
            message = (
                "我可以协助整理层数、卧室数、目标建筑面积、建筑风格、屋顶、车库和地形适应方式等设计偏好。"
                "请尽量给出明确数值或选项，我会将可识别的偏好转成参数补丁。"
            )
        if request.site_context.parcel_loaded:
            message += "\n已载入地块地形数据，但这本身不代表已计算退界或法定包络。"
        elif request.site_context.address:
            message += "\n当前地址为 " + request.site_context.address + "，但本次请求没有可用于法定包络计算的已验证场地与规则集。"
        return message + "\n\n规划合规状态：尚未评估。当前聊天不执行完整的 3D Legal Envelope、已确认 Auckland 规划规则集或资源许可判定。"

    if values:
        changes = []
        for key, value in values.items():
            shown = str(value)
            if key == "gross_floor_area_target_m2":
                shown += " m²"
            elif key == "storeys":
                shown += " storeys"
            elif key == "bedrooms":
                shown += " bedrooms"
            changes.append(_LABELS.get(key, key) + ": " + shown)
        message = "I parsed these as structured design preferences; the matching House Generator inputs will be updated: " + "; ".join(changes) + "."
    else:
        message = (
            "I can help capture storeys, bedroom count, target floor area, architectural style, roof, garage and terrain preferences. "
            "Please give a specific value or option and I will convert recognised preferences into a structured parameter patch."
        )
    if request.site_context.parcel_loaded:
        message += " Parcel terrain is loaded, but that does not mean a setback or Legal Envelope has been calculated."
    return message + "\n\nPlanning compliance: NOT EVALUATED. This chat does not run the complete 3D Legal Envelope, planner-confirmed Auckland rule pack, or resource-consent determination."
