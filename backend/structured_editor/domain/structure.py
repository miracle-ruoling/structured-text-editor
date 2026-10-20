"""Semantic chapters are independent of physical Word sections and user tags."""


def assign_chapters(blocks: list[dict]) -> list[dict]:
    chapters = [{"id": "intro", "name": "前言区域（首个小标题之前）", "level": 0, "count": 0}]
    stack = []
    by_id = {"intro": chapters[0]}
    for block in blocks:
        if block["role"] == "heading" and not block["in_table"]:
            level = block.get("outline_level")
            level = level + 1 if level is not None and 0 <= level <= 8 else 1
            while stack and stack[-1]["level"] >= level:
                stack.pop()
            chapter = {
                "id": block["id"],
                "name": block["text"][:100] or "空小标题",
                "level": level,
                "count": 0,
            }
            chapters.append(chapter)
            by_id[chapter["id"]] = chapter
            stack.append(chapter)
        block["chapter_ids"] = [item["id"] for item in stack] or ["intro"]
        for identity in block["chapter_ids"]:
            by_id[identity]["count"] += 1
    return [chapter for chapter in chapters if chapter["count"]]
