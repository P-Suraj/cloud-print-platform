from typing import Dict, Any, Tuple
import re


def _selected_page_count(page_range: Any, logical_page_count: int) -> int:
    if page_range is None or str(page_range).strip() == "":
        return logical_page_count
    value = str(page_range).strip()
    if not re.fullmatch(r"\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*", value):
        raise ValueError("page_range must look like 1-5, 8, 11-15")
    selected = set()
    for part in value.split(","):
        bounds = [int(number) for number in part.strip().split("-")]
        start, end = (bounds[0], bounds[0]) if len(bounds) == 1 else bounds
        if start < 1 or end < start or end > logical_page_count:
            raise ValueError(f"page_range must stay between 1 and {logical_page_count}")
        selected.update(range(start, end + 1))
    return len(selected)

def calculate_quote_price(
    logical_page_count: int,
    options: Dict[str, Any],
    rate_card_rules: Dict[str, Any]
) -> Tuple[float, Dict[str, Any]]:
    """
    Pure deterministic pricing calculation.
    Returns: (total_amount: float, breakdown_json: dict)
    """
    copies = int(options.get("copies", 1))
    color_mode = str(options.get("color_mode", "bw")).lower()
    duplex_value = options.get("duplex", False)
    if copies < 1 or copies > 100:
        raise ValueError("copies must be between 1 and 100")
    if color_mode not in {"bw", "color"}:
        raise ValueError("color_mode must be 'bw' or 'color'")
    if not isinstance(duplex_value, bool):
        raise ValueError("duplex must be a boolean")
    if logical_page_count < 1:
        raise ValueError("logical_page_count must be positive")
    duplex = duplex_value

    selected_pages = _selected_page_count(options.get("page_range"), logical_page_count)
    total_sides = selected_pages * copies

    # Select appropriate slab key
    if color_mode == "color":
        slab_key = "color_duplex_slabs" if duplex else "color_simplex_slabs"
    else:
        slab_key = "bw_duplex_slabs" if duplex else "bw_simplex_slabs"

    slabs = rate_card_rules.get(slab_key)
    if not isinstance(slabs, list) or not slabs:
        raise ValueError(f"rate card is missing {slab_key}")

    # Find matching rate slab
    rate_per_side = None
    for slab in slabs:
        if slab["min_pages"] <= total_sides <= slab["max_pages"]:
            rate_per_side = float(slab["rate"])
            break
    if rate_per_side is None or rate_per_side < 0:
        raise ValueError("rate card has no valid slab for this job")

    total_amount = round(total_sides * rate_per_side, 2)

    breakdown = {
        "logical_page_count": logical_page_count,
        "selected_page_count": selected_pages,
        "copies": copies,
        "total_printed_sides": total_sides,
        "color_mode": color_mode,
        "duplex": duplex,
        "applied_slab": slab_key,
        "rate_per_side": rate_per_side,
        "total_amount": total_amount,
        "currency": "INR"
    }

    return total_amount, breakdown
