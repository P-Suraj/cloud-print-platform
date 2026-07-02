import re
import logging
from supabase import create_client, Client
import config

logger = logging.getLogger("PrintAgent.ShopResolver")

def extract_shop_code(input_str: str) -> str:
    """
    Extracts the shop code from a raw user input, which can either be 
    a direct code (e.g., KRL004) or a setup URL (e.g., https://autoprint.in/setup/KRL004).
    Converts extracted shop code to uppercase.
    """
    if not input_str:
        return ""
        
    input_str = input_str.strip()
    
    # Matches URL patterns like:
    # http://autoprint.in/setup/KRL004
    # https://www.autoprint.in/setup/KRL004
    # autoprint.in/setup/KRL004
    url_pattern = r"(?:https?://)?(?:www\.)?autoprint\.in/setup/([A-Za-z0-9_-]+)"
    match = re.search(url_pattern, input_str, re.IGNORECASE)
    if match:
        extracted = match.group(1)
        return extracted.upper()
        
    # If no URL pattern is found, assume the user entered the code directly
    # Strip any trailing/leading slashes or spaces
    return input_str.strip("/").upper()

def resolve_shop_code(shop_code: str) -> dict:
    """
    Queries Supabase to resolve the alphanumeric shop_code to the internal UUID and name.
    Validates that the shop_code follows the format: exactly 3 uppercase letters and 3 digits.
    
    Returns:
        dict: {
            "success": bool,
            "shop_id": str (UUID) or None,
            "shop_name": str or None,
            "error": str or None
        }
    """
    if not shop_code:
        return {
            "success": False,
            "shop_id": None,
            "shop_name": None,
            "error": "Shop code cannot be empty."
        }
    
    # Enforce format validation (exactly 3 uppercase letters and 3 digits)
    if not re.match(r"^[A-Z]{3}\d{3}$", shop_code):
        return {
            "success": False,
            "shop_id": None,
            "shop_name": None,
            "error": "Invalid format. Shop code must be exactly 3 uppercase letters and 3 digits (e.g. KRL004)."
        }
        
    try:
        # Create a fresh client connection
        client: Client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
        
        # Query shops table for matching active code
        response = client.table("shops") \
            .select("id, name, is_active") \
            .eq("shop_code", shop_code) \
            .execute()
            
        records = response.data
        
        if not records:
            return {
                "success": False,
                "shop_id": None,
                "shop_name": None,
                "error": f"Shop code '{shop_code}' not found."
            }
            
        shop = records[0]
        if not shop.get("is_active", True):
            return {
                "success": False,
                "shop_id": None,
                "shop_name": None,
                "error": f"Shop '{shop_code}' is currently inactive."
            }
            
        return {
            "success": True,
            "shop_id": shop["id"],
            "shop_name": shop["name"],
            "error": None
        }
        
    except Exception as e:
        logger.exception("Error occurred while querying Supabase for shop_code")
        return {
            "success": False,
            "shop_id": None,
            "shop_name": None,
            "error": f"Connection failed: {str(e)}"
        }

