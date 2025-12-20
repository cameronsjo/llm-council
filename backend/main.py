"""FastAPI backend for LLM Council."""

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio

from . import storage
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings, aggregate_metrics, perform_web_search
from .arena import run_arena_debate, create_participant_mapping, round1_initial_positions, round_n_deliberation, final_synthesis, aggregate_arena_metrics
from .websearch import is_web_search_available
from .models import fetch_available_models
from .config import get_council_models, get_chairman_model, update_council_config, DEFAULT_ARENA_ROUNDS, MIN_ARENA_ROUNDS, MAX_ARENA_ROUNDS

app = FastAPI(title="LLM Council API")

# Enable CORS for local development (when running frontend separately)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3100"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files directory (built frontend)
STATIC_DIR = Path(__file__).parent.parent / "static"


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class ArenaConfig(BaseModel):
    """Configuration for arena mode debates."""
    round_count: int = Field(
        default=DEFAULT_ARENA_ROUNDS,
        ge=MIN_ARENA_ROUNDS,
        le=MAX_ARENA_ROUNDS,
        description=f"Number of debate rounds ({MIN_ARENA_ROUNDS}-{MAX_ARENA_ROUNDS})"
    )


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    use_web_search: bool = False
    mode: str = Field(default="council", pattern="^(council|arena)$")
    arena_config: Optional[ArenaConfig] = None


class UpdateConfigRequest(BaseModel):
    """Request to update council configuration."""
    council_models: List[str]
    chairman_model: str


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
    messages: List[Dict[str, Any]]


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/config")
async def get_config():
    """Get API configuration and feature availability."""
    return {
        "web_search_available": is_web_search_available(),
        "council_models": get_council_models(),
        "chairman_model": get_chairman_model(),
        "arena": {
            "default_rounds": DEFAULT_ARENA_ROUNDS,
            "min_rounds": MIN_ARENA_ROUNDS,
            "max_rounds": MAX_ARENA_ROUNDS,
        },
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


@app.get("/api/models")
async def get_available_models():
    """Get list of available models from OpenRouter."""
    models = await fetch_available_models()
    return {"models": models}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        use_web_search=request.use_web_search
    )

    # Add assistant message with all stages and metrics
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metrics=metadata.get('metrics')
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the council or arena process.
    Returns Server-Sent Events as each stage/round completes.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def council_event_generator():
        """Generate events for council mode (3-stage process)."""
        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Optionally perform web search
            web_search_context = None
            web_search_error = None
            if request.use_web_search:
                yield f"data: {json.dumps({'type': 'web_search_start'})}\n\n"
                web_search_context, web_search_error = await perform_web_search(request.content)
                yield f"data: {json.dumps({'type': 'web_search_complete', 'data': {'found': web_search_context is not None, 'error': web_search_error}})}\n\n"

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(request.content, web_search_context)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(request.content, stage1_results)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            metadata = {
                'label_to_model': label_to_model,
                'aggregate_rankings': aggregate_rankings,
                'web_search_used': web_search_context is not None,
                'web_search_error': web_search_error,
            }
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': metadata})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(request.content, stage1_results, stage2_results)
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Calculate and send aggregated metrics
            metrics = aggregate_metrics(stage1_results, stage2_results, stage3_result)
            yield f"data: {json.dumps({'type': 'metrics_complete', 'data': metrics})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message with metrics
            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result,
                metrics=metrics
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    async def arena_event_generator():
        """Generate events for arena mode (multi-round debate)."""
        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content)

            # Get arena configuration
            arena_config = request.arena_config or ArenaConfig()
            round_count = arena_config.round_count

            # Start title generation in parallel
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Optionally perform web search
            web_search_context = None
            web_search_error = None
            if request.use_web_search:
                yield f"data: {json.dumps({'type': 'web_search_start'})}\n\n"
                web_search_context, web_search_error = await perform_web_search(request.content)
                yield f"data: {json.dumps({'type': 'web_search_complete', 'data': {'found': web_search_context is not None, 'error': web_search_error}})}\n\n"

            # Create participant mapping
            council_models = get_council_models()
            participant_mapping = create_participant_mapping(council_models)

            # Send arena start event
            yield f"data: {json.dumps({'type': 'arena_start', 'data': {'participant_count': len(participant_mapping), 'round_count': round_count, 'participants': list(participant_mapping.keys())}})}\n\n"

            from .arena import ArenaRound

            rounds: List[ArenaRound] = []

            # Round 1: Initial positions
            yield f"data: {json.dumps({'type': 'round_start', 'data': {'round_number': 1, 'round_type': 'initial'}})}\n\n"
            round1 = await round1_initial_positions(
                request.content, participant_mapping, round_count, web_search_context
            )
            rounds.append(round1)
            yield f"data: {json.dumps({'type': 'round_complete', 'data': round1.to_dict()})}\n\n"

            # Rounds 2-N: Deliberation
            for round_num in range(2, round_count + 1):
                yield f"data: {json.dumps({'type': 'round_start', 'data': {'round_number': round_num, 'round_type': 'deliberation'}})}\n\n"
                deliberation_round = await round_n_deliberation(
                    request.content, round_num, round_count, rounds, participant_mapping
                )
                rounds.append(deliberation_round)
                yield f"data: {json.dumps({'type': 'round_complete', 'data': deliberation_round.to_dict()})}\n\n"

            # Final synthesis
            yield f"data: {json.dumps({'type': 'synthesis_start'})}\n\n"
            synthesis = await final_synthesis(request.content, rounds, participant_mapping)
            yield f"data: {json.dumps({'type': 'synthesis_complete', 'data': synthesis, 'participant_mapping': participant_mapping})}\n\n"

            # Calculate and send metrics
            rounds_as_dicts = [r.to_dict() for r in rounds]
            metrics = aggregate_arena_metrics(rounds, synthesis)
            yield f"data: {json.dumps({'type': 'metrics_complete', 'data': metrics})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save arena message
            storage.add_arena_message(
                conversation_id,
                rounds_as_dicts,
                synthesis,
                participant_mapping,
                metrics=metrics
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            import traceback
            traceback.print_exc()
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
