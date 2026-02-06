"""Tests for pure functions in backend.attachments."""

import base64

from backend.attachments import (
    encode_image_for_vision,
    get_file_extension,
    get_file_type,
    validate_file,
    MAX_IMAGE_SIZE,
    MAX_PDF_SIZE,
    MAX_TEXT_SIZE,
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
