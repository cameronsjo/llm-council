"""FastAPI backend for LLM Council."""

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import storage
from .logging_config import (
    set_correlation_id,
    set_current_user,
    setup_logging,
)
from .telemetry import (
    instrument_fastapi,
    instrument_httpx,
    setup_telemetry,
)

# Configure structured logging (must happen before any logging calls)
setup_logging()
logger = logging.getLogger(__name__)

# Initialize OpenTelemetry (must happen before creating FastAPI app for best results)
setup_telemetry()
instrument_httpx()
from .arena import (
    aggregate_arena_metrics,
    convert_arena_to_unified_result,
    create_participant_mapping,
    final_synthesis,
    round1_initial_positions,
    round_n_deliberation,
)
from .attachments import (
    process_attachments,
    save_attachment,
    validate_file,
)
from .auth import AUTH_ENABLED, User, get_optional_user
from .config import (
    DEFAULT_ARENA_ROUNDS,
    MAX_ARENA_ROUNDS,
    MIN_ARENA_ROUNDS,
    get_chairman_model,
    get_council_models,
    get_curated_models,
    reload_config,
    update_council_config,
    update_curated_models,
)
from .council import (
    aggregate_metrics,
    calculate_aggregate_rankings,
    convert_to_unified_result,
    generate_conversation_title,
    perform_web_search,
    run_full_council,
    stage2_collect_rankings,
    stage3_synthesize_final,
)
from .council_stream import CouncilPipelineInput, run_council_pipeline
from .export import export_to_json, export_to_markdown
from .models import fetch_available_models, invalidate_cache as invalidate_models_cache
from .websearch import get_search_provider, is_web_search_available

app = FastAPI(title="LLM Council API")

# Instrument FastAPI with OpenTelemetry (after app creation)
instrument_fastapi(app)

# Enable CORS for local development (when running frontend separately)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3100"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def logging_context_middleware(request: Request, call_next):
    """Middleware to set logging context from request headers."""
    # Extract correlation ID from header or generate one
    correlation_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    set_correlation_id(correlation_id)

    # Extract user from auth headers (if present)
    remote_user = request.headers.get("Remote-User")
    if remote_user:
        set_current_user(remote_user)

    try:
        response = await call_next(request)
        # Add correlation ID to response headers for traceability
        response.headers["X-Request-ID"] = correlation_id
        return response
    finally:
        # Clear context after request
        set_correlation_id(None)
        set_current_user(None)

# Static files directory (built frontend)
STATIC_DIR = Path(__file__).parent.parent / "static"


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    council_models: list[str] | None = None
    chairman_model: str | None = None


class ArenaConfig(BaseModel):
    """Configuration for arena mode debates."""
    round_count: int = Field(
        default=DEFAULT_ARENA_ROUNDS,
        ge=MIN_ARENA_ROUNDS,
        le=MAX_ARENA_ROUNDS,
        description=f"Number of debate rounds ({MIN_ARENA_ROUNDS}-{MAX_ARENA_ROUNDS})"
    )


class AttachmentRef(BaseModel):
    """Reference to an uploaded attachment."""
    id: str
    filename: str
    file_type: str


class PriorContext(BaseModel):
    """Context from a previous conversation to continue discussion."""

    original_question: str = Field(description="The original question from the prior conversation")
    synthesis: str = Field(description="The chairman's synthesis/conclusion from the prior conversation")
    source_conversation_id: str | None = Field(
        default=None, description="ID of the source conversation (for reference)"
    )


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""

    content: str
    use_web_search: bool = False
    mode: str = Field(default="council", pattern="^(council|arena)$")
    arena_config: ArenaConfig | None = None
    attachments: list[AttachmentRef] = Field(default_factory=list)
    resume: bool = Field(default=False, description="Resume from partial results if available")
    prior_context: PriorContext | None = Field(
        default=None, description="Context from a previous conversation to continue"
    )


class UpdateConfigRequest(BaseModel):
    """Request to update council configuration."""
    council_models: list[str]
    chairman_model: str


class UpdateConversationRequest(BaseModel):
    """Request to update conversation metadata."""
    title: str | None = None


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: list[dict[str, Any]]


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/version")
async def get_version():
    """Get application version information."""
    from .version import get_version_info

    info = get_version_info()
    return {
        "version": info.version,
        "git_commit": info.git_commit,
        "git_commit_short": info.git_commit_short,
        "build_time": info.build_time,
        "repo_url": info.repo_url,
        "commit_url": info.commit_url,
        "release_url": info.release_url,
    }


@app.get("/api/config")
async def get_config():
    """Get API configuration and feature availability."""
    return {
        "web_search_available": is_web_search_available(),
        "search_provider": get_search_provider(),
        "council_models": get_council_models(),
        "chairman_model": get_chairman_model(),
        "curated_models": get_curated_models(),
        "arena": {
            "default_rounds": DEFAULT_ARENA_ROUNDS,
            "min_rounds": MIN_ARENA_ROUNDS,
            "max_rounds": MAX_ARENA_ROUNDS,
        },
        "auth_enabled": AUTH_ENABLED,
    }


@app.get("/api/user")
async def get_user_info(user: User | None = Depends(get_optional_user)):
    """Get current user information from auth headers."""
    if not user:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name,
        "groups": user.groups,
    }


@app.post("/api/config")
async def update_config(request: UpdateConfigRequest):
    """Update council configuration."""
    if len(request.council_models) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 council models are required"
        )

    config = update_council_config(
        council_models=request.council_models,
        chairman_model=request.chairman_model
    )

    return {
        "status": "ok",
        "council_models": config.get('council_models', get_council_models()),
        "chairman_model": config.get('chairman_model', get_chairman_model()),
    }


@app.post("/api/config/reload")
async def reload_config_endpoint():
    """Reload configuration from .env and config files.

    This allows updating API keys and other settings without restarting
    the server. Useful for:
    - Adding/changing API keys
    - Updating default model configuration
    """
    result = reload_config()
    return result


class UpdateCuratedModelsRequest(BaseModel):
    """Request to update curated models list."""
    model_ids: list[str] = Field(..., description="List of model IDs to curate")


@app.get("/api/curated-models")
async def get_curated_models_endpoint():
    """Get user's curated model list."""
    return {"curated_models": get_curated_models()}


@app.post("/api/curated-models")
async def update_curated_models_endpoint(request: UpdateCuratedModelsRequest):
    """Update curated models list."""
    curated = update_curated_models(request.model_ids)
    return {"status": "ok", "curated_models": curated}


@app.get("/api/models")
async def get_available_models():
    """Get list of available models from OpenRouter."""
    models = await fetch_available_models()
    return {"models": models}


@app.post("/api/models/refresh")
async def refresh_available_models():
    """Refresh the available models list from OpenRouter.

    Invalidates the cache and fetches fresh data from the API.
    Use this when new models are available on OpenRouter.
    """
    invalidate_models_cache()
    models = await fetch_available_models()
    return {"models": models, "refreshed": True}


@app.post("/api/attachments")
async def upload_attachment(
    file: UploadFile = File(...),
    user: User | None = Depends(get_optional_user),
):
    """Upload a file attachment.

    Supported file types:
    - Text: .txt, .md, .json, .csv, .xml, .html, .py, .js, .ts
    - PDF: .pdf
    - Images: .png, .jpg, .jpeg, .gif, .webp
    """
    user_id = user.username if user else None

    # Read file content
    content = await file.read()
    filename = file.filename or "unnamed"

    # Validate file
    is_valid, error = validate_file(filename, content)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)

    # Save attachment
    attachment = save_attachment(filename, content, user_id)

    return attachment


@app.get("/api/conversations", response_model=list[ConversationMetadata])
async def list_conversations(user: User | None = Depends(get_optional_user)):
    """List all conversations (metadata only)."""
    user_id = user.username if user else None
    return storage.list_conversations(user_id=user_id)


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(
    request: CreateConversationRequest,
    user: User | None = Depends(get_optional_user),
):
    """Create a new conversation with optional model config."""
    user_id = user.username if user else None
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(
        conversation_id,
        user_id=user_id,
        council_models=request.council_models,
        chairman_model=request.chairman_model,
    )
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(
    conversation_id: str,
    user: User | None = Depends(get_optional_user),
):
    """Get a specific conversation with all its messages."""
    user_id = user.username if user else None
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.patch("/api/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    request: UpdateConversationRequest,
    user: User | None = Depends(get_optional_user),
):
    """Update conversation metadata (title, etc.)."""
    user_id = user.username if user else None
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if request.title is not None:
        storage.update_conversation_title(conversation_id, request.title, user_id=user_id)

    return {"status": "ok", "id": conversation_id, "title": request.title}


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    user: User | None = Depends(get_optional_user),
):
    """Delete a conversation."""
    user_id = user.username if user else None
    deleted = storage.delete_conversation(conversation_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "ok", "id": conversation_id}


@app.get("/api/conversations/{conversation_id}/export/markdown")
async def export_conversation_markdown(
    conversation_id: str,
    user: User | None = Depends(get_optional_user),
):
    """Export a conversation as Markdown."""
    user_id = user.username if user else None
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    markdown_content = export_to_markdown(conversation)
    title = conversation.get("title", "conversation").replace(" ", "_")
    filename = f"{title}.md"

    return StreamingResponse(
        iter([markdown_content]),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/conversations/{conversation_id}/export/json")
async def export_conversation_json(
    conversation_id: str,
    user: User | None = Depends(get_optional_user),
):
    """Export a conversation as JSON."""
    user_id = user.username if user else None
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    json_content = export_to_json(conversation)
    title = conversation.get("title", "conversation").replace(" ", "_")
    filename = f"{title}.json"

    return StreamingResponse(
        iter([json.dumps(json_content, indent=2)]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/conversations/{conversation_id}/pending")
async def get_pending_status(
    conversation_id: str,
    user: User | None = Depends(get_optional_user),
):
    """Get pending response status for a conversation."""
    user_id = user.username if user else None

    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    pending = storage.get_pending_message(conversation_id, user_id=user_id)
    if not pending:
        return {"pending": False}

    is_stale = storage.is_pending_stale(pending)
    has_error = bool(pending.get("partial_data", {}).get("error"))

    return {
        "pending": True,
        "stale": is_stale,
        "has_error": has_error,
        "mode": pending.get("mode"),
        "started_at": pending.get("started_at"),
        "last_update": pending.get("last_update"),
        "partial_data": pending.get("partial_data", {}),
        "user_content": pending.get("user_content"),
    }


@app.delete("/api/conversations/{conversation_id}/pending")
async def clear_pending_status(
    conversation_id: str,
    user: User | None = Depends(get_optional_user),
):
    """Clear pending status and optionally remove the last user message for retry."""
    user_id = user.username if user else None

    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Clear pending and remove the last user message
    storage.clear_pending(conversation_id, user_id=user_id)
    removed = storage.remove_last_user_message(conversation_id, user_id=user_id)

    return {"status": "ok", "user_message_removed": removed}


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(
    conversation_id: str,
    request: SendMessageRequest,
    user: User | None = Depends(get_optional_user),
):
    """Send a message and run the 3-stage council process.

    Returns the complete response with all stages.
    """
    user_id = user.username if user else None

    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content, user_id=user_id)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title, user_id=user_id)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content, use_web_search=request.use_web_search
    )

    # Add assistant message with all stages and metrics
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metrics=metadata.get("metrics"),
        user_id=user_id,
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata,
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(
    conversation_id: str,
    request: SendMessageRequest,
    user: User | None = Depends(get_optional_user),
):
    """Send a message and stream the council or arena process.

    Returns Server-Sent Events as each stage/round completes.
    """
    user_id = user.username if user else None

    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def council_event_generator():
        """Generate SSE-formatted events for council mode."""
        council_models, chairman_model = storage.get_conversation_config(
            conversation_id, user_id=user_id
        )

        prior_context_text = ""
        prior_context_source_id = None
        if request.prior_context:
            prior_context_text = (
                "## Prior Discussion Context\n\n"
                f"**Original Question:** {request.prior_context.original_question}\n\n"
                f"**Council's Previous Conclusion:**\n{request.prior_context.synthesis}\n\n"
                "---\n\n"
                "The user now has a follow-up question based on this prior discussion:\n\n"
            )
            prior_context_source_id = request.prior_context.source_conversation_id

        attachment_dicts = (
            [a.model_dump() for a in request.attachments]
            if request.attachments
            else []
        )

        pipeline_input = CouncilPipelineInput(
            conversation_id=conversation_id,
            user_id=user_id,
            content=request.content,
            council_models=council_models,
            chairman_model=chairman_model,
            is_first_message=is_first_message,
            use_web_search=request.use_web_search,
            resume=request.resume,
            attachments=attachment_dicts,
            prior_context_text=prior_context_text,
            prior_context_source_id=prior_context_source_id,
        )

        async for event in run_council_pipeline(pipeline_input):
            yield f"data: {json.dumps(event)}\n\n"

    async def arena_event_generator():
        """Generate events for arena mode (multi-round debate)."""
        try:
            # Get per-conversation config (with global fallback)
            council_models, chairman_model = storage.get_conversation_config(
                conversation_id, user_id=user_id
            )

            # Add user message
            storage.add_user_message(conversation_id, request.content, user_id=user_id)

            # Mark as pending
            storage.mark_response_pending(
                conversation_id, "arena", request.content, user_id=user_id
            )

            # Get arena configuration
            arena_config = request.arena_config or ArenaConfig()
            round_count = arena_config.round_count

            # Start title generation in parallel
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(
                    generate_conversation_title(request.content)
                )

            # Process attachments if any
            attachment_context = ""
            if request.attachments:
                attachment_dicts = [a.model_dump() for a in request.attachments]
                text_context, _ = process_attachments(attachment_dicts, user_id)
                if text_context:
                    attachment_context = f"## Attached Documents\n\n{text_context}\n\n---\n\n"

            # Optionally perform web search
            web_search_context = None
            web_search_error = None
            if request.use_web_search:
                yield f"data: {json.dumps({'type': 'web_search_start'})}\n\n"
                web_search_context, web_search_error = await perform_web_search(
                    request.content
                )
                yield f"data: {json.dumps({'type': 'web_search_complete', 'data': {'found': web_search_context is not None, 'error': web_search_error}})}\n\n"

            # Combine attachment and web search context
            combined_context = attachment_context
            if web_search_context:
                combined_context += web_search_context

            # Create participant mapping
            participant_mapping = create_participant_mapping(council_models)

            # Send arena start event
            yield f"data: {json.dumps({'type': 'arena_start', 'data': {'participant_count': len(participant_mapping), 'round_count': round_count, 'participants': list(participant_mapping.keys())}})}\n\n"

            from .arena import ArenaRound

            rounds: list[ArenaRound] = []

            # Round 1: Initial positions
            yield f"data: {json.dumps({'type': 'round_start', 'data': {'round_number': 1, 'round_type': 'initial'}})}\n\n"
            round1 = await round1_initial_positions(
                request.content, participant_mapping, round_count, combined_context or None
            )
            rounds.append(round1)
            yield f"data: {json.dumps({'type': 'round_complete', 'data': round1.to_dict()})}\n\n"

            # Update pending progress after round 1
            storage.update_pending_progress(
                conversation_id,
                {"rounds": [round1.to_dict()]},
                user_id=user_id,
            )

            # Rounds 2-N: Deliberation
            for round_num in range(2, round_count + 1):
                yield f"data: {json.dumps({'type': 'round_start', 'data': {'round_number': round_num, 'round_type': 'deliberation'}})}\n\n"
                deliberation_round = await round_n_deliberation(
                    request.content, round_num, round_count, rounds, participant_mapping
                )
                rounds.append(deliberation_round)
                yield f"data: {json.dumps({'type': 'round_complete', 'data': deliberation_round.to_dict()})}\n\n"

                # Update pending progress after each round
                storage.update_pending_progress(
                    conversation_id,
                    {"rounds": [r.to_dict() for r in rounds]},
                    user_id=user_id,
                )

            # Final synthesis
            yield f"data: {json.dumps({'type': 'synthesis_start'})}\n\n"
            synthesis = await final_synthesis(
                request.content, rounds, participant_mapping, chairman_model
            )
            yield f"data: {json.dumps({'type': 'synthesis_complete', 'data': synthesis, 'participant_mapping': participant_mapping})}\n\n"

            # Calculate and send metrics
            rounds_as_dicts = [r.to_dict() for r in rounds]
            metrics = aggregate_arena_metrics(rounds, synthesis)
            yield f"data: {json.dumps({'type': 'metrics_complete', 'data': metrics})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(
                    conversation_id, title, user_id=user_id
                )
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Convert to unified format and save
            unified_result = convert_arena_to_unified_result(
                rounds_as_dicts,
                synthesis,
                participant_mapping,
                metrics,
            )
            storage.add_unified_message(
                conversation_id,
                unified_result,
                user_id=user_id,
            )

            # Clear pending on success
            storage.clear_pending(conversation_id, user_id=user_id)

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            import traceback

            traceback.print_exc()
            # Update pending with error
            storage.update_pending_progress(
                conversation_id, {"error": str(e)}, user_id=user_id
            )
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    # Choose the appropriate event generator based on mode
    if request.mode == "arena":
        generator = arena_event_generator()
    else:
        generator = council_event_generator()

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/api/conversations/{conversation_id}/extend-debate/stream")
async def extend_arena_debate_stream(
    conversation_id: str,
    user: User | None = Depends(get_optional_user),
):
    """Add one more deliberation round to an existing arena debate.

    Returns Server-Sent Events as the new round and synthesis complete.
    """
    user_id = user.username if user else None

    # Get conversation
    conversation = storage.get_conversation(conversation_id, user_id=user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Find the last assistant message that's an arena debate
    last_arena_msg = None
    last_user_msg = None
    for i, msg in enumerate(reversed(conversation["messages"])):
        if msg.get("role") == "assistant" and msg.get("mode") == "arena":
            last_arena_msg = msg
            # Find the user message before it
            msg_idx = len(conversation["messages"]) - 1 - i
            if msg_idx > 0:
                last_user_msg = conversation["messages"][msg_idx - 1]
            break

    if not last_arena_msg:
        raise HTTPException(status_code=400, detail="No arena debate found in this conversation")

    if not last_user_msg or last_user_msg.get("role") != "user":
        raise HTTPException(status_code=400, detail="Could not find original user query")

    async def extend_event_generator():
        """Generate events for extending the arena debate with one more round."""
        try:
            from .arena import ArenaRound

            # Get per-conversation config
            council_models, chairman_model = storage.get_conversation_config(
                conversation_id, user_id=user_id
            )

            # Extract existing data from the last arena message
            existing_rounds = last_arena_msg.get("rounds", [])
            participant_mapping = last_arena_msg.get("participant_mapping", {})
            original_query = last_user_msg.get("content", "")

            if not existing_rounds or not participant_mapping:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Invalid arena debate data'})}\n\n"
                return

            # Convert existing rounds to ArenaRound objects
            arena_rounds: list[ArenaRound] = []
            for rd in existing_rounds:
                arena_rounds.append(ArenaRound(
                    round_number=rd["round_number"],
                    round_type=rd["round_type"],
                    responses=rd["responses"],
                ))

            # Calculate new round number
            new_round_number = len(arena_rounds) + 1
            new_total_rounds = new_round_number

            yield f"data: {json.dumps({'type': 'extend_start', 'data': {'new_round_number': new_round_number}})}\n\n"

            # Run one more deliberation round
            yield f"data: {json.dumps({'type': 'round_start', 'data': {'round_number': new_round_number, 'round_type': 'deliberation'}})}\n\n"
            new_round = await round_n_deliberation(
                original_query, new_round_number, new_total_rounds, arena_rounds, participant_mapping
            )
            arena_rounds.append(new_round)
            yield f"data: {json.dumps({'type': 'round_complete', 'data': new_round.to_dict()})}\n\n"

            # Run new synthesis
            yield f"data: {json.dumps({'type': 'synthesis_start'})}\n\n"
            synthesis = await final_synthesis(
                original_query, arena_rounds, participant_mapping, chairman_model
            )
            yield f"data: {json.dumps({'type': 'synthesis_complete', 'data': synthesis, 'participant_mapping': participant_mapping})}\n\n"

            # Calculate metrics
            rounds_as_dicts = [r.to_dict() for r in arena_rounds]
            metrics = aggregate_arena_metrics(arena_rounds, synthesis)
            yield f"data: {json.dumps({'type': 'metrics_complete', 'data': metrics})}\n\n"

            # Convert to unified format
            unified_result = convert_arena_to_unified_result(
                rounds_as_dicts,
                synthesis,
                participant_mapping,
                metrics,
            )

            # Update the last assistant message in storage
            storage.update_last_arena_message(
                conversation_id,
                unified_result,
                user_id=user_id,
            )

            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        extend_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# Serve static files if the directory exists (production mode)
if STATIC_DIR.exists():
    # Mount static assets (JS, CSS, etc.)
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    # Root route serves SPA
    @app.get("/")
    async def serve_root():
        """Serve the SPA index."""
        return FileResponse(STATIC_DIR / "index.html")

    # Catch-all route for SPA - must be last
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA for any non-API route."""
        # Don't intercept API routes
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        # Try to serve the exact file first
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        # Otherwise serve index.html for SPA routing
        return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
