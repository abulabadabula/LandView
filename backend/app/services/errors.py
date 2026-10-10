class UpstreamError(Exception):
    """An external data service failed or is not configured."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
