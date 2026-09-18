import logging
import os

import requests

logger = logging.getLogger(__name__)


def _get_jina_api_key() -> str | None:
    value = os.getenv("JINA_API_KEY", "").strip()
    if not value or value == "your-jina-api-key" or value.startswith("your-"):
        return None
    return value


class JinaClient:
    def _direct_fetch(self, url: str, timeout: int) -> str:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; DeerFlowWebFetch/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        }
        response = requests.get(url, headers=headers, timeout=timeout)
        response.raise_for_status()
        response.encoding = response.encoding or response.apparent_encoding
        return response.text

    def crawl(self, url: str, return_format: str = "html", timeout: int = 10) -> str:
        headers = {
            "Content-Type": "application/json",
            "X-Return-Format": return_format,
            "X-Timeout": str(timeout),
        }
        api_key = _get_jina_api_key()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        else:
            logger.warning("Jina API key is not set. Provide your own key to access a higher rate limit. See https://jina.ai/reader for more information.")
        data = {"url": url}
        try:
            response = requests.post("https://r.jina.ai/", headers=headers, json=data, timeout=timeout + 5)

            if response.status_code != 200:
                error_message = f"Jina API returned status {response.status_code}: {response.text}"
                logger.error(error_message)
                try:
                    return self._direct_fetch(url, timeout=timeout)
                except Exception as fallback_exc:
                    return f"Error: {error_message}; direct fetch fallback failed: {fallback_exc}"

            if not response.text or not response.text.strip():
                error_message = "Jina API returned empty response"
                logger.error(error_message)
                try:
                    return self._direct_fetch(url, timeout=timeout)
                except Exception as fallback_exc:
                    return f"Error: {error_message}; direct fetch fallback failed: {fallback_exc}"

            return response.text
        except Exception as e:
            error_message = f"Request to Jina API failed: {str(e)}"
            logger.error(error_message)
            try:
                logger.warning("Falling back to direct fetch for URL: %s", url)
                return self._direct_fetch(url, timeout=timeout)
            except Exception as fallback_exc:
                return f"Error: {error_message}; direct fetch fallback failed: {fallback_exc}"
