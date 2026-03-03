import os
from supabase import create_client, Client

_supabase_client: Client | None = None

def get_supabase() -> Client | None:
    """Get Supabase client (service role for backend operations)."""
    global _supabase_client
    if _supabase_client:
        return _supabase_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        return None
    _supabase_client = create_client(url, key)
    return _supabase_client
