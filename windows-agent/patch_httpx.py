import httpx

# Save original constructors
original_client_init = httpx.Client.__init__
original_async_init = httpx.AsyncClient.__init__

def patched_client_init(self, *args, **kwargs):
    if "proxy" in kwargs:
        kwargs["proxies"] = kwargs.pop("proxy")
    original_client_init(self, *args, **kwargs)

def patched_async_init(self, *args, **kwargs):
    if "proxy" in kwargs:
        kwargs["proxies"] = kwargs.pop("proxy")
    original_async_init(self, *args, **kwargs)

# Apply patches
httpx.Client.__init__ = patched_client_init
httpx.AsyncClient.__init__ = patched_async_init
