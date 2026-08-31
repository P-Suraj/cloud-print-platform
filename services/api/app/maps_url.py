import re
from urllib.parse import urlparse

# Allowed Google Maps URL prefixes
ALLOWED_MAPS_DOMAINS = {
    "maps.google.com",
    "www.google.com",
    "google.com",
    "maps.app.goo.gl",
    "goo.gl",
}

def validate_maps_url(url: str) -> bool:
    """
    Validate that a given URL is a legitimate, safe Google Maps deep-link.
    Rejects JavaScript URIs, data URIs, non-HTTPS protocols (or plain HTTP if malformed),
    and untrusted domains. Max length 2000 characters.
    """
    if not url or not isinstance(url, str):
        return False
    
    clean_url = url.strip()
    if len(clean_url) > 2000 or len(clean_url) < 10:
        return False
    
    # Must use https
    if not clean_url.startswith("https://"):
        return False
    
    # Basic check against forbidden tokens/characters
    lower_url = clean_url.lower()
    if "javascript:" in lower_url or "data:" in lower_url or "<" in lower_url or ">" in lower_url or '"' in lower_url:
        return False

    try:
        parsed = urlparse(clean_url)
        if parsed.scheme != "https":
            return False
        
        hostname = (parsed.hostname or "").lower()
        if hostname not in ALLOWED_MAPS_DOMAINS:
            # Allow subdomains of google.com only if path starts with /maps
            if hostname.endswith(".google.com"):
                if not parsed.path.startswith("/maps"):
                    return False
            else:
                return False

        if hostname in ("www.google.com", "google.com") and not parsed.path.startswith("/maps"):
            return False

        if hostname == "goo.gl" and not parsed.path.startswith("/maps"):
            return False

        return True
    except Exception:
        return False
