"""Tests for pure functions in backend.attachments."""

import base64
import io

import pytest
from fastapi import HTTPException, Request, UploadFile
from fastapi.testclient import TestClient

from backend.attachments import (
    content_length_exceeds,
    encode_image_for_vision,
    get_file_extension,
    get_file_type,
    read_capped,
    validate_file,
    MAX_IMAGE_SIZE,
    MAX_PDF_SIZE,
    MAX_TEXT_SIZE,
)
from tests.conftest import build_request


def _request_with_headers(headers: dict[str, str]) -> Request:
    """Build a POST /api/attachments Request (see conftest.build_request)."""
    return build_request(
        method="POST",
        path="/api/attachments",
        client=("127.0.0.1", 12345),
        headers=headers,
    )


# ---------------------------------------------------------------------------
# get_file_extension
# ---------------------------------------------------------------------------

class TestGetFileExtension:
    """Tests for get_file_extension."""

    def test_standard_extension(self):
        """Standard extension is returned lowercase with dot."""
        assert get_file_extension("document.pdf") == ".pdf"

    def test_uppercase_extension(self):
        """Uppercase extension is lowercased."""
        assert get_file_extension("FILE.TXT") == ".txt"

    def test_no_extension(self):
        """Filename without extension returns empty string."""
        assert get_file_extension("noext") == ""

    def test_multiple_dots(self):
        """Only the last extension is returned."""
        assert get_file_extension("archive.tar.gz") == ".gz"


# ---------------------------------------------------------------------------
# get_file_type
# ---------------------------------------------------------------------------

class TestGetFileType:
    """Tests for get_file_type."""

    def test_text_types(self):
        """Text file extensions return 'text'."""
        for ext in (".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".xml", ".html"):
            assert get_file_type(f"file{ext}") == "text", f"Failed for {ext}"

    def test_pdf_type(self):
        """PDF extension returns 'pdf'."""
        assert get_file_type("doc.pdf") == "pdf"

    def test_image_types(self):
        """Image extensions return 'image'."""
        for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
            assert get_file_type(f"photo{ext}") == "image", f"Failed for {ext}"

    def test_unsupported_extension(self):
        """Unsupported extension returns None."""
        assert get_file_type("file.exe") is None
        assert get_file_type("file.zip") is None
        assert get_file_type("file.docx") is None


# ---------------------------------------------------------------------------
# validate_file
# ---------------------------------------------------------------------------

class TestValidateFile:
    """Tests for validate_file."""

    def test_valid_text_file(self):
        """Valid text file under size limit passes."""
        content = b"Hello, world!"
        is_valid, error = validate_file("readme.txt", content)
        assert is_valid is True
        assert error is None

    def test_valid_pdf_file(self):
        """Valid PDF under size limit passes."""
        content = b"%PDF-1.4 fake content"
        is_valid, error = validate_file("doc.pdf", content)
        assert is_valid is True
        assert error is None

    def test_valid_image_file(self):
        """Valid image under size limit passes."""
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        is_valid, error = validate_file("photo.png", content)
        assert is_valid is True
        assert error is None

    def test_unsupported_file_type(self):
        """Unsupported file type fails validation."""
        is_valid, error = validate_file("program.exe", b"binary data")
        assert is_valid is False
        assert "Unsupported file type" in error

    def test_text_file_over_1mb(self):
        """Text file over 1MB fails validation."""
        content = b"x" * (MAX_TEXT_SIZE + 1)
        is_valid, error = validate_file("big.txt", content)
        assert is_valid is False
        assert "too large" in error.lower()

    def test_pdf_file_over_10mb(self):
        """PDF over 10MB fails validation."""
        content = b"x" * (MAX_PDF_SIZE + 1)
        is_valid, error = validate_file("big.pdf", content)
        assert is_valid is False
        assert "too large" in error.lower()

    def test_image_file_over_5mb(self):
        """Image over 5MB fails validation."""
        content = b"x" * (MAX_IMAGE_SIZE + 1)
        is_valid, error = validate_file("big.png", content)
        assert is_valid is False
        assert "too large" in error.lower()

    def test_exactly_at_limit_passes(self):
        """File exactly at the size limit passes validation."""
        content = b"x" * MAX_TEXT_SIZE
        is_valid, error = validate_file("exact.txt", content)
        assert is_valid is True
        assert error is None


# ---------------------------------------------------------------------------
# encode_image_for_vision
# ---------------------------------------------------------------------------

class TestEncodeImageForVision:
    """Tests for encode_image_for_vision."""

    def test_png_image_returns_data_uri(self):
        """PNG image returns correct data URI structure."""
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 10
        result = encode_image_for_vision("photo.png", content)

        assert result is not None
        assert result["type"] == "image_url"
        url = result["image_url"]["url"]
        assert url.startswith("data:image/png;base64,")

        # Verify base64 content round-trips
        b64_part = url.split(",", 1)[1]
        decoded = base64.b64decode(b64_part)
        assert decoded == content

    def test_jpeg_image(self):
        """JPEG image uses correct mime type."""
        content = b"\xff\xd8\xff" + b"\x00" * 10
        result = encode_image_for_vision("photo.jpg", content)

        assert result is not None
        assert "image/jpeg" in result["image_url"]["url"]

    def test_non_image_returns_none(self):
        """Non-image file returns None."""
        assert encode_image_for_vision("doc.pdf", b"pdf data") is None
        assert encode_image_for_vision("code.py", b"print('hi')") is None

    def test_webp_image(self):
        """WebP image uses correct mime type."""
        content = b"RIFF" + b"\x00" * 10
        result = encode_image_for_vision("photo.webp", content)

        assert result is not None
        assert "image/webp" in result["image_url"]["url"]


# ---------------------------------------------------------------------------
# content_length_exceeds — fast-path Content-Length reject (issue #37)
# ---------------------------------------------------------------------------

class TestContentLengthExceeds:
    """Tests for content_length_exceeds."""

    def test_over_cap_returns_true(self):
        """A well-formed Content-Length over the cap returns True."""
        request = _request_with_headers({"content-length": str(MAX_PDF_SIZE + 1)})
        assert content_length_exceeds(request, MAX_PDF_SIZE) is True

    def test_under_cap_returns_false(self):
        """A Content-Length under the cap returns False."""
        request = _request_with_headers({"content-length": str(MAX_PDF_SIZE - 1)})
        assert content_length_exceeds(request, MAX_PDF_SIZE) is False

    def test_at_cap_returns_false(self):
        """A Content-Length exactly at the cap is not over."""
        request = _request_with_headers({"content-length": str(MAX_PDF_SIZE)})
        assert content_length_exceeds(request, MAX_PDF_SIZE) is False

    def test_absent_header_returns_false(self):
        """No Content-Length header returns False (fall through to chunked cap)."""
        request = _request_with_headers({})
        assert content_length_exceeds(request, MAX_PDF_SIZE) is False

    def test_malformed_header_treated_as_absent(self):
        """A malformed Content-Length is treated as absent, never raises."""
        request = _request_with_headers({"content-length": "not-a-number"})
        assert content_length_exceeds(request, MAX_PDF_SIZE) is False

    def test_duplicated_header_treated_as_absent(self):
        """A duplicated/comma-joined Content-Length is treated as absent."""
        request = _request_with_headers({"content-length": "100, 200"})
        assert content_length_exceeds(request, MAX_PDF_SIZE) is False


# ---------------------------------------------------------------------------
# read_capped — hard in-memory chunked cap (issue #37)
# ---------------------------------------------------------------------------

class TestReadCapped:
    """Tests for read_capped."""

    async def test_under_cap_returns_full_content(self):
        """Content under the cap is returned in full."""
        content = b"x" * 1000
        upload = UploadFile(filename="small.txt", file=io.BytesIO(content))
        result = await read_capped(upload, MAX_PDF_SIZE)
        assert result == content

    async def test_over_cap_raises_413(self):
        """Content over the cap raises HTTPException(413) before full read."""
        content = b"x" * (MAX_PDF_SIZE + 65536)
        upload = UploadFile(filename="huge.pdf", file=io.BytesIO(content))
        with pytest.raises(HTTPException) as exc_info:
            await read_capped(upload, MAX_PDF_SIZE)
        assert exc_info.value.status_code == 413

    async def test_exactly_at_cap_passes(self):
        """Content exactly at the cap does not raise."""
        content = b"x" * MAX_PDF_SIZE
        upload = UploadFile(filename="exact.pdf", file=io.BytesIO(content))
        result = await read_capped(upload, MAX_PDF_SIZE)
        assert len(result) == MAX_PDF_SIZE

    async def test_one_byte_over_cap_on_partial_final_chunk_raises(self):
        """A single byte over the cap trips 413 even on a partial final chunk."""
        content = b"x" * (MAX_PDF_SIZE + 1)
        upload = UploadFile(filename="just-over.pdf", file=io.BytesIO(content))
        with pytest.raises(HTTPException) as exc_info:
            await read_capped(upload, MAX_PDF_SIZE)
        assert exc_info.value.status_code == 413


# ---------------------------------------------------------------------------
# /api/attachments integration — the 413/400 status-code contract (issue #37)
# ---------------------------------------------------------------------------

class TestUploadEndpoint:
    """Integration tests for the upload handler's size gates."""

    def _client(self) -> TestClient:
        from backend.main import app

        return TestClient(app)

    def test_oversized_upload_returns_413_without_saving(self, monkeypatch):
        """Attack case: a >10MB body is rejected 413 and save_attachment is not called."""
        import backend.main

        called = False

        def spy_save(*args, **kwargs):
            nonlocal called
            called = True
            return {}

        monkeypatch.setattr(backend.main, "save_attachment", spy_save)

        oversized = b"x" * (MAX_PDF_SIZE + 1024)
        response = self._client().post(
            "/api/attachments",
            files={"file": ("huge.pdf", oversized, "application/pdf")},
        )

        assert response.status_code == 413
        assert "too large" in response.json()["detail"].lower()
        assert called is False, "save_attachment must not run for a rejected upload"

    def test_per_type_overflow_returns_400(self):
        """A 2MB .txt (over MAX_TEXT_SIZE, under MAX_PDF_SIZE) fails 400 via validate_file."""
        body = b"x" * (MAX_TEXT_SIZE + 1024 * 1024)  # ~2MB, well under 10MB
        response = self._client().post(
            "/api/attachments",
            files={"file": ("big.txt", body, "text/plain")},
        )

        assert response.status_code == 400
        assert "too large" in response.json()["detail"].lower()

    def test_valid_small_upload_returns_200(self):
        """A valid small text file uploads successfully."""
        response = self._client().post(
            "/api/attachments",
            files={"file": ("hello.txt", b"hello world", "text/plain")},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["filename"] == "hello.txt"
        assert body["file_type"] == "text"

    def test_upload_just_under_cap_succeeds(self):
        """A PDF a few KB under MAX_PDF_SIZE clears every size gate end to end.

        Exercises content_length_exceeds, read_capped, and validate_file
        together through a real multipart request. The margin (4KB) is
        deliberate: a multipart body's own Content-Length includes the
        boundary and part headers on top of the file bytes, so a file
        whose *content* sits exactly at MAX_PDF_SIZE produces a *request*
        Content-Length slightly above it — see
        test_file_content_exactly_at_cap_is_413_via_multipart_overhead
        for that finding.
        """
        near_cap = b"x" * (MAX_PDF_SIZE - 4096)
        response = self._client().post(
            "/api/attachments",
            files={"file": ("near-cap.pdf", near_cap, "application/pdf")},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["filename"] == "near-cap.pdf"
        assert body["size"] == MAX_PDF_SIZE - 4096

    def test_file_content_exactly_at_cap_is_413_via_multipart_overhead(self):
        """FINDING: a file whose own content is exactly MAX_PDF_SIZE is rejected.

        content_length_exceeds checks the *request's* Content-Length against
        MAX_PDF_SIZE, but a multipart body's Content-Length includes the
        boundary markers and part headers on top of the file bytes. So a
        file exactly at the documented per-type cap trips the fast-path
        413 even though its own content never exceeds MAX_PDF_SIZE — the
        effective usable file size for multipart uploads is a few hundred
        bytes below the advertised cap. Not a security hole (fails closed,
        conservative direction) but the cap is under-documented as exact.
        """
        exact = b"x" * MAX_PDF_SIZE
        response = self._client().post(
            "/api/attachments",
            files={"file": ("exact.pdf", exact, "application/pdf")},
        )

        assert response.status_code == 413
