import threading
import time
from collections import deque


class TwseRateLimiter:
    def __init__(self, max_requests: int = 3, period_seconds: int = 5) -> None:
        self._max_requests = max_requests
        self._period_seconds = period_seconds
        self._timestamps: deque[float] = deque()
        self._lock = threading.Lock()

    def wait(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                while self._timestamps and now - self._timestamps[0] >= self._period_seconds:
                    self._timestamps.popleft()

                if len(self._timestamps) < self._max_requests:
                    self._timestamps.append(now)
                    return

                wait_seconds = self._period_seconds - (now - self._timestamps[0])

            if wait_seconds > 0:
                time.sleep(wait_seconds)


twse_rate_limiter = TwseRateLimiter()
