"""LLM Council TUI - Terminal User Interface for LLM Council."""

import asyncio
from typing import Any

from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical, VerticalScroll
from textual.reactive import reactive
from textual.widgets import (
    Button,
    Footer,
    Header,
    Input,
    Label,
    ListItem,
    ListView,
    Markdown,
    Static,
    TabbedContent,
    TabPane,
)

from .api import CouncilAPI, Conversation

# Default API URL
DEFAULT_API_URL = "http://localhost:8001"


class ConversationItem(ListItem):
    """A conversation item in the sidebar list."""

    def __init__(self, conversation: Conversation) -> None:
        super().__init__()
        self.conversation = conversation

    def compose(self) -> ComposeResult:
        title = self.conversation.title[:30]
        if len(self.conversation.title) > 30:
            title += "..."
        yield Label(title, classes="conv-title")
        yield Label(
            f"{self.conversation.message_count} messages",
            classes="conv-meta",
        )


class StagePanel(Static):
    """Panel for displaying a stage's content."""

    def __init__(self, title: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.title = title
        self._content = ""

    def compose(self) -> ComposeResult:
        yield Label(self.title, classes="stage-title")
        yield Markdown("", id="stage-content", classes="stage-content")

    def update_content(self, content: str) -> None:
        """Update the stage content."""
        self._content = content
        md = self.query_one("#stage-content", Markdown)
        md.update(content)


class ResponsePanel(Static):
    """Panel showing individual model response."""

    def __init__(self, model: str, response: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.model_name = model
        self.response_text = response

    def compose(self) -> ComposeResult:
        yield Label(f"📝 {self.model_name}", classes="model-name")
        yield Markdown(self.response_text, classes="model-response")


class ChatMessage(Static):
    """A chat message (user or assistant)."""

    def __init__(self, role: str, content: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.role = role
        self.content = content

    def compose(self) -> ComposeResult:
        role_label = "You" if self.role == "user" else "Council"
        role_class = "user-role" if self.role == "user" else "assistant-role"
        yield Label(role_label, classes=f"message-role {role_class}")
        yield Markdown(self.content, classes="message-content")


class CouncilTUI(App):
    """LLM Council Terminal User Interface."""

    CSS = """
    /* Layout */
    #main-container {
        layout: horizontal;
    }

    #sidebar {
        width: 30;
        background: $surface;
        border-right: solid $primary;
        padding: 0 1;
    }

    #sidebar-header {
        height: 3;
        padding: 1;
        background: $primary;
        color: $text;
        text-align: center;
    }

    #conversation-list {
        height: 1fr;
    }

    #new-conv-btn {
        width: 100%;
        margin: 1 0;
    }

    #chat-area {
        width: 1fr;
    }

    #messages {
        height: 1fr;
        padding: 1;
    }

    #input-area {
        height: auto;
        max-height: 5;
        padding: 1;
        background: $surface;
        border-top: solid $primary;
    }

    #message-input {
        width: 1fr;
    }

    #send-btn {
        width: 12;
    }

    /* Messages */
    ChatMessage {
        padding: 1;
        margin-bottom: 1;
        background: $surface;
        border: solid $primary-background;
    }

    .message-role {
        text-style: bold;
        margin-bottom: 1;
    }

    .user-role {
        color: $success;
    }

    .assistant-role {
        color: $warning;
    }

    /* Conversation list */
    ConversationItem {
        padding: 1;
    }

    ConversationItem:hover {
        background: $primary 20%;
    }

    .conv-title {
        text-style: bold;
    }

    .conv-meta {
        color: $text-muted;
        text-style: italic;
    }

    /* Stage panels */
    StagePanel {
        border: solid $primary;
        margin: 1;
        padding: 1;
    }

    .stage-title {
        text-style: bold;
        color: $primary;
        margin-bottom: 1;
    }

    /* Model responses */
    ResponsePanel {
        border: solid $secondary;
        margin: 1;
        padding: 1;
    }

    .model-name {
        text-style: bold;
        color: $secondary;
    }

    /* Status */
    #status-bar {
        height: 1;
        background: $primary;
        color: $text;
        padding: 0 1;
    }

    /* Loading */
    .loading {
        color: $warning;
        text-style: italic;
    }

    /* Tabs */
    TabbedContent {
        height: 1fr;
    }
    """

    BINDINGS = [
        Binding("ctrl+n", "new_conversation", "New"),
        Binding("ctrl+q", "quit", "Quit"),
        Binding("ctrl+d", "delete_conversation", "Delete"),
        Binding("escape", "cancel", "Cancel"),
    ]

    # Reactive state
    current_conversation_id: reactive[str | None] = reactive(None)
    is_loading: reactive[bool] = reactive(False)

    def __init__(self, api_url: str = DEFAULT_API_URL) -> None:
        super().__init__()
        self.api = CouncilAPI(api_url)
        self.conversations: list[Conversation] = []

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Container(id="main-container"):
            with Vertical(id="sidebar"):
                yield Static("🏛️ LLM Council", id="sidebar-header")
                yield Button("+ New Conversation", id="new-conv-btn", variant="primary")
                yield ListView(id="conversation-list")
            with Vertical(id="chat-area"):
                yield VerticalScroll(id="messages")
                with Horizontal(id="input-area"):
                    yield Input(
                        placeholder="Ask the council...",
                        id="message-input",
                    )
                    yield Button("Send", id="send-btn", variant="primary")
        yield Footer()

    async def on_mount(self) -> None:
        """Load initial data when app mounts."""
        await self.load_conversations()

    async def on_unmount(self) -> None:
        """Cleanup when app unmounts."""
        await self.api.close()

    async def load_conversations(self) -> None:
        """Load conversations from the API."""
        try:
            self.conversations = await self.api.list_conversations()
            list_view = self.query_one("#conversation-list", ListView)
            await list_view.clear()
            for conv in self.conversations:
                await list_view.append(ConversationItem(conv))
        except Exception as e:
            self.notify(f"Failed to load conversations: {e}", severity="error")

    async def load_conversation(self, conversation_id: str) -> None:
        """Load a specific conversation and display its messages."""
        try:
            conv_data = await self.api.get_conversation(conversation_id)
            messages_container = self.query_one("#messages", VerticalScroll)
            await messages_container.remove_children()

            for msg in conv_data.get("messages", []):
                if msg["role"] == "user":
                    await messages_container.mount(
                        ChatMessage("user", msg["content"])
                    )
                else:
                    # Assistant message - show synthesis if available
                    if msg.get("stage3"):
                        content = msg["stage3"].get("response", "")
                        await messages_container.mount(
                            ChatMessage("assistant", content)
                        )
                    elif msg.get("synthesis"):
                        # Arena mode
                        content = msg["synthesis"].get("content", "")
                        await messages_container.mount(
                            ChatMessage("assistant", content)
                        )

            # Scroll to bottom
            messages_container.scroll_end(animate=False)
        except Exception as e:
            self.notify(f"Failed to load conversation: {e}", severity="error")

    @on(Button.Pressed, "#new-conv-btn")
    async def handle_new_conversation(self) -> None:
        """Create a new conversation."""
        await self.action_new_conversation()

    @on(Button.Pressed, "#send-btn")
    async def handle_send(self) -> None:
        """Send a message."""
        await self.send_message()

    @on(Input.Submitted, "#message-input")
    async def handle_input_submit(self) -> None:
        """Handle Enter key in input."""
        await self.send_message()

    @on(ListView.Selected, "#conversation-list")
    async def handle_conversation_select(self, event: ListView.Selected) -> None:
        """Handle conversation selection."""
        if isinstance(event.item, ConversationItem):
            self.current_conversation_id = event.item.conversation.id
            await self.load_conversation(event.item.conversation.id)

    async def send_message(self) -> None:
        """Send a message to the council."""
        input_widget = self.query_one("#message-input", Input)
        content = input_widget.value.strip()

        if not content:
            return

        if not self.current_conversation_id:
            # Create a new conversation first
            try:
                conv = await self.api.create_conversation()
                self.current_conversation_id = conv.id
                await self.load_conversations()
            except Exception as e:
                self.notify(f"Failed to create conversation: {e}", severity="error")
                return

        # Clear input
        input_widget.value = ""

        # Add user message to display
        messages_container = self.query_one("#messages", VerticalScroll)
        await messages_container.mount(ChatMessage("user", content))

        # Stream the response
        self.stream_response(content)

    @work(exclusive=True)
    async def stream_response(self, content: str) -> None:
        """Stream the council's response."""
        self.is_loading = True
        messages_container = self.query_one("#messages", VerticalScroll)

        # Add loading indicator
        loading = Static("⏳ Council is deliberating...", classes="loading")
        await messages_container.mount(loading)
        messages_container.scroll_end(animate=False)

        stage1_responses: list[dict[str, Any]] = []
        stage3_response = ""

        try:
            async for event_type, event in self.api.send_message_stream(
                self.current_conversation_id,  # type: ignore
                content,
            ):
                if event_type == "stage1_start":
                    loading.update("📝 Stage 1: Collecting individual responses...")
                elif event_type == "stage1_complete":
                    stage1_responses = event.get("data", [])
                    loading.update(
                        f"✅ Stage 1 complete ({len(stage1_responses)} responses)"
                    )
                elif event_type == "stage2_start":
                    loading.update("🔄 Stage 2: Peer rankings...")
                elif event_type == "stage2_complete":
                    loading.update("✅ Stage 2 complete")
                elif event_type == "stage3_start":
                    loading.update("🎯 Stage 3: Final synthesis...")
                elif event_type == "stage3_complete":
                    stage3_response = event.get("data", {}).get("response", "")
                elif event_type == "complete":
                    break
                elif event_type == "error":
                    self.notify(
                        f"Error: {event.get('message', 'Unknown error')}",
                        severity="error",
                    )
                    break

            # Remove loading indicator
            await loading.remove()

            # Show final response
            if stage3_response:
                await messages_container.mount(
                    ChatMessage("assistant", stage3_response)
                )
                messages_container.scroll_end(animate=False)

            # Reload conversation list to update message count
            await self.load_conversations()

        except Exception as e:
            await loading.remove()
            self.notify(f"Error: {e}", severity="error")
        finally:
            self.is_loading = False

    async def action_new_conversation(self) -> None:
        """Create a new conversation."""
        try:
            conv = await self.api.create_conversation()
            self.current_conversation_id = conv.id
            await self.load_conversations()

            # Clear messages
            messages_container = self.query_one("#messages", VerticalScroll)
            await messages_container.remove_children()

            # Focus input
            self.query_one("#message-input", Input).focus()

            self.notify("New conversation created", severity="information")
        except Exception as e:
            self.notify(f"Failed to create conversation: {e}", severity="error")

    async def action_delete_conversation(self) -> None:
        """Delete the current conversation."""
        if not self.current_conversation_id:
            self.notify("No conversation selected", severity="warning")
            return

        try:
            await self.api.delete_conversation(self.current_conversation_id)
            self.current_conversation_id = None

            # Clear messages
            messages_container = self.query_one("#messages", VerticalScroll)
            await messages_container.remove_children()

            await self.load_conversations()
            self.notify("Conversation deleted", severity="information")
        except Exception as e:
            self.notify(f"Failed to delete conversation: {e}", severity="error")

    def action_cancel(self) -> None:
        """Cancel current operation."""
        self.query_one("#message-input", Input).focus()


def main() -> None:
    """Run the TUI app."""
    import argparse

    parser = argparse.ArgumentParser(description="LLM Council TUI")
    parser.add_argument(
        "--api-url",
        default=DEFAULT_API_URL,
        help=f"API base URL (default: {DEFAULT_API_URL})",
    )
    args = parser.parse_args()

    app = CouncilTUI(api_url=args.api_url)
    app.run()


if __name__ == "__main__":
    main()
