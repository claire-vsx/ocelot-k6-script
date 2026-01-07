#!/usr/bin/env python3
"""
Comprehensive Classroom Simulation Script - Fixed Socket Connection
"""

import asyncio
import json
import logging
import random
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

import requests
import socketio

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Set to True to see detailed Socket.IO debug logs
DEBUG_SOCKETIO = True
PARTICIPANT_NS = "/participant"

if DEBUG_SOCKETIO:
    logging.getLogger("socketio").setLevel(logging.DEBUG)
    logging.getLogger("engineio").setLevel(logging.DEBUG)
else:
    # Filter out "packet queue is empty" messages - these are expected during normal disconnect
    class PacketQueueFilter(logging.Filter):
        def filter(self, record):
            return "packet queue is empty" not in record.getMessage().lower()

    engineio_logger = logging.getLogger("engineio.client")
    engineio_logger.addFilter(PacketQueueFilter())


@dataclass
class EventTracker:
    """Track socket events received by students"""

    batch_quizzes_created: Set[str] = field(
        default_factory=set
    )  # Using student_id (string)
    batch_quizzes_finished: Set[str] = field(default_factory=set)
    batch_quizzes_disclosed: Set[str] = field(default_factory=set)
    batch_quizzes_closed: Set[str] = field(default_factory=set)
    student_points: Set[str] = field(default_factory=set)

    def assert_all_received(
        self,
        event_name: str,
        expected_student_ids: Set[str],
        total_students: Optional[int] = None,
    ) -> bool:
        """Assert all students received the event

        Args:
            event_name: Name of the event to check
            expected_student_ids: Set of student_ids that should have received the event
            total_students: Total number of students (for logging purposes)
        """
        event_set = getattr(self, event_name)
        received = len(event_set)
        expected_count = len(expected_student_ids)

        # Show comparison with total students if provided
        if total_students and total_students != expected_count:
            logger.info(
                f"📊 Event '{event_name}': {received} received | "
                f"{expected_count} expected (seated) | {total_students} total students"
            )

        if received == expected_count and event_set == expected_student_ids:
            logger.info(
                f"✅ All {expected_count} students received '{event_name}' event"
            )
            if total_students and total_students > expected_count:
                logger.warning(
                    f"   Note: {total_students - expected_count} students didn't choose seats (expected {expected_count} seated out of {total_students} total)"
                )
            return True
        else:
            logger.error(
                f"❌ Only {received}/{expected_count} students received '{event_name}' event"
            )
            missing = expected_student_ids - event_set
            if missing:
                logger.error(f"   Missing student_ids: {sorted(missing)}")
            unexpected = event_set - expected_student_ids
            if unexpected:
                logger.warning(
                    f"   Unexpected student_ids (received but not expected): {sorted(unexpected)}"
                )
            if total_students and total_students > expected_count:
                logger.warning(
                    f"   Note: Only {expected_count}/{total_students} students chose seats"
                )
            return False


class Teacher:
    """Handles teacher operations"""

    def __init__(
        self, api_url: str, access_token: str, room_id: str, collection_id: str
    ):
        self.api_url = api_url.rstrip("/")
        self.access_token = access_token
        self.room_id = room_id
        self.collection_id = collection_id
        self.lesson_id: Optional[str] = None

    def create_lesson(self) -> Optional[str]:
        """Create a lesson and return lesson_id"""
        url = f"{self.api_url}/api/v3/rooms/{self.room_id}/lessons"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

        try:
            logger.info(f"Teacher creating lesson for room: {self.room_id}")
            response = requests.post(url, headers=headers, timeout=30)
            response.raise_for_status()

            data = response.json()
            self.lesson_id = data["data"]["lesson_id"]
            logger.info(f"✅ Lesson created successfully: {self.lesson_id}")
            return self.lesson_id

        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Failed to create lesson: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return None

    def create_batch_quizzes(self, lesson_id: str) -> Optional[str]:
        """Create batch quizzes and return batch_quizzes_id"""
        url = f"{self.api_url}/api/v3/lessons/{lesson_id}/quizzes/batch_quizzes"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

        payload = {
            "quizzes": [
                {
                    "img_url": f"https://example.com/lesson_id_{lesson_id}/img/quiz1.png",
                    "source_type": "QUIZ_GENERATOR",
                    "option_type": "TRUE_FALSE",
                    "collection_id": self.collection_id,
                    "quiz_type": "TRUE_FALSE",
                    "content": "Water boils at 100°C at sea level.",
                    "chirp_id": None,
                    "ai_short_answer": None,
                    "seq": 1,
                    "option_list": [
                        {
                            "option_id": 1,
                            "content": "True",
                            "is_ai_answer": True,
                            "is_answer": True,
                            "reason": None,
                        },
                        {
                            "option_id": 2,
                            "content": "False",
                            "is_ai_answer": False,
                            "reason": None,
                        },
                    ],
                },
                {
                    "img_url": f"https://example.com/lesson_id_{lesson_id}/img/quiz2.png",
                    "source_type": "QUIZ_GENERATOR",
                    "option_type": "ALPHABET",
                    "collection_id": self.collection_id,
                    "quiz_type": "SINGLE_SELECT",
                    "content": "What is 2 + 2?",
                    "chirp_id": None,
                    "ai_short_answer": None,
                    "seq": 2,
                    "option_list": [
                        {
                            "option_id": 1,
                            "content": "3",
                            "is_ai_answer": False,
                            "is_answer": False,
                            "reason": None,
                        },
                        {
                            "option_id": 2,
                            "content": "4",
                            "is_ai_answer": True,
                            "is_answer": True,
                            "reason": None,
                        },
                        {
                            "option_id": 3,
                            "content": "5",
                            "is_ai_answer": False,
                            "is_answer": False,
                            "reason": None,
                        },
                    ],
                },
                {
                    "img_url": f"https://example.com/lesson_id_{lesson_id}/img/quiz3.png",
                    "source_type": "QUIZ_GENERATOR",
                    "option_type": "NUMBER",
                    "collection_id": self.collection_id,
                    "quiz_type": "MULTIPLE_SELECT",
                    "content": "Which of these are prime numbers?",
                    "chirp_id": None,
                    "ai_short_answer": None,
                    "seq": 3,
                    "option_list": [
                        {
                            "option_id": 1,
                            "content": "2",
                            "is_ai_answer": True,
                            "reason": None,
                        },
                        {
                            "option_id": 2,
                            "content": "3",
                            "is_ai_answer": False,
                            "reason": None,
                        },
                        {
                            "option_id": 3,
                            "content": "4",
                            "is_ai_answer": True,
                            "reason": None,
                        },
                        {
                            "option_id": 4,
                            "content": "5",
                            "is_ai_answer": False,
                            "reason": None,
                        },
                    ],
                },
            ]
        }

        try:
            logger.info(f"Teacher creating batch quizzes for lesson: {lesson_id}")
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            response.raise_for_status()

            data = response.json()
            batch_quizzes_id = data["data"]["batch_quizzes_id"]
            logger.info(f"✅ Batch quizzes created successfully: {batch_quizzes_id}")
            return batch_quizzes_id

        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Failed to create batch quizzes: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return None

    def update_batch_quiz_status(
        self, lesson_id: str, batch_quizzes_id: str, status: str
    ) -> bool:
        """Update batch quiz status (FINISH or CLOSE)"""
        url = f"{self.api_url}/api/v3/lessons/{lesson_id}/quizzes/batch_quizzes/{batch_quizzes_id}"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        payload = {"status": status}

        try:
            logger.info(f"Teacher updating batch quiz status to: {status}")
            response = requests.put(url, headers=headers, json=payload, timeout=30)
            response.raise_for_status()
            logger.info(f"✅ Batch quiz status updated to {status}")
            return True

        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Failed to update batch quiz status: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return False

    def disclose_batch_quiz(self, lesson_id: str, batch_quizzes_id: str) -> bool:
        """Disclose batch quiz answers"""
        url = f"{self.api_url}/api/v3/lessons/{lesson_id}/quizzes/batch_quizzes/{batch_quizzes_id}/disclose"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

        try:
            logger.info(f"Teacher disclosing batch quiz: {batch_quizzes_id}")
            response = requests.put(url, headers=headers, timeout=30)
            response.raise_for_status()
            logger.info(f"✅ Batch quiz disclosed")
            return True

        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Failed to disclose batch quiz: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return False

    def add_student_points(self, lesson_id: str, students: List[Dict]) -> bool:
        """Add points to students"""
        url = f"{self.api_url}/api/v3/lessons/{lesson_id}/batch_points"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        payload = {"students": students}

        try:
            logger.info(f"Teacher adding points to {len(students)} students")
            response = requests.put(url, headers=headers, json=payload, timeout=30)
            response.raise_for_status()
            logger.info(f"✅ Points added successfully")
            return True

        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Failed to add points: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return False


class Student:
    """Handles student operations"""

    def __init__(
        self,
        student_number: int,
        api_url: str,
        socket_url: str,
        event_tracker: EventTracker,
    ):
        self.student_number = student_number
        self.api_url = api_url.rstrip("/")
        self.socket_url = socket_url
        self.device_id = str(uuid.uuid4())

        # Create Socket.IO client with reconnection enabled
        self.sio = socketio.AsyncClient(
            logger=False,  # Suppress normal logs
            engineio_logger=False,  # Suppress engineio logs including "packet queue is empty"
            reconnection=True,
            reconnection_attempts=5,
            reconnection_delay=1,
            reconnection_delay_max=5,
            # Add default ack timeout (10 seconds)
            # This gives handlers time to process before server timeout
            request_timeout=30,
        )

        self.sid: Optional[str] = None
        self.student_id: Optional[str] = None
        self.socket_token: Optional[str] = None
        self.connected = False
        self.event_tracker = event_tracker
        self.latest_batch_quizzes_id: Optional[str] = None
        self.quiz_data: Optional[Dict] = None
        self.lesson_id: Optional[str] = None  # Store lesson_id for reconnection
        self.disconnect_reason: Optional[str] = None  # Store disconnect reason

        # Register socket event handlers
        self.sio.on("connect", self.on_connect, namespace=PARTICIPANT_NS)
        self.sio.on("disconnect", self.on_disconnect, namespace=PARTICIPANT_NS)
        self.sio.on("connect_error", self.on_connect_error, namespace=PARTICIPANT_NS)
        self.sio.on(
            "batch_quizzes_created",
            self.on_batch_quizzes_created,
            namespace=PARTICIPANT_NS,
        )
        self.sio.on(
            "batch_quizzes_finished",
            self.on_batch_quizzes_finished,
            namespace=PARTICIPANT_NS,
        )
        self.sio.on(
            "batch_quizzes_disclosed",
            self.on_batch_quizzes_disclosed,
            namespace=PARTICIPANT_NS,
        )
        self.sio.on(
            "batch_quizzes_closed",
            self.on_batch_quizzes_closed,
            namespace=PARTICIPANT_NS,
        )
        self.sio.on("student_points", self.on_student_points, namespace=PARTICIPANT_NS)
        # Catch-all handler for any other events
        self.sio.on("*", self.on_any_event, namespace=PARTICIPANT_NS)

    async def on_connect(self):
        """Handle socket connection"""
        self.connected = True
        # Wait a bit for the namespace connection to complete and sid to be set
        await asyncio.sleep(0.1)
        # Get the namespace-specific sid (this matches the server's sid)
        # Use get_sid() to get the namespace-specific sid, not self.sio.sid
        namespace_sid = self.sio.get_sid(PARTICIPANT_NS)
        if namespace_sid:
            # Refresh sid with the new connection
            old_sid = self.sid
            self.sid = namespace_sid
            if old_sid and old_sid != namespace_sid:
                logger.info(
                    f"Student {self.student_number} refreshed SID on reconnect: {old_sid} -> {namespace_sid}"
                )
            else:
                logger.info(
                    f"Student {self.student_number} connected with SID: {self.sid} (namespace: {PARTICIPANT_NS})"
                )

            # Emit join_lesson event if we have the required information (for reconnection)
            if self.lesson_id and self.student_id and self.socket_token:
                try:
                    logger.info(
                        f"Student {self.student_id} emitting join_lesson on connect/reconnect"
                    )
                    await self.sio.emit(
                        "join_lesson",
                        {
                            "lesson_id": self.lesson_id,
                            "user_id": self.student_id,  # Using student_id as user_id
                            "role": "student",
                            "access_token": self.socket_token,  # Using socket_token as access_token
                        },
                        namespace=PARTICIPANT_NS,
                    )
                    logger.info(
                        f"✅ Student {self.student_id} emitted join_lesson event on connect with SID: {self.sid}"
                    )
                except Exception as e:
                    logger.error(
                        f"❌ Student {self.student_id} failed to emit join_lesson on connect: {e}"
                    )
                    import traceback

                    logger.error(traceback.format_exc())
        else:
            logger.warning(
                f"Student {self.student_number} connected but namespace sid is None - this might cause issues"
            )

    async def on_disconnect(self, *args, **kwargs):
        """
        Handle socket disconnection.
        Records the disconnect reason. The join_lesson event will be emitted
        automatically when the socket reconnects (in on_connect handler).
        """
        # Extract reason from arguments if provided
        reason = None
        if args:
            reason = args[0] if len(args) > 0 else None
        if not reason and "reason" in kwargs:
            reason = kwargs["reason"]

        # Store disconnect reason
        self.disconnect_reason = str(reason) if reason else "Unknown"

        was_connected = self.connected
        self.connected = False

        if was_connected:
            logger.warning(
                f"⚠️  Student {self.student_number} DISCONNECTED (had SID: {self.sid})"
            )
            logger.warning(f"   Disconnect Reason: {self.disconnect_reason}")

            # Log the state when disconnection happened
            logger.warning(
                f"   State: student_id={'set' if self.student_id else 'not set'}, "
                f"socket_token={'set' if self.socket_token else 'not set'}, "
                f"lesson_id={'set' if self.lesson_id else 'not set'}"
            )

        else:
            logger.info(f"Student {self.student_id} disconnected (expected)")

    async def on_connect_error(self, data):
        """Handle connection error"""
        logger.error(f"❌ Student {self.student_number} connection error: {data}")

    def on_any_event(self, event, *args):
        """Catch-all handler for any unhandled events - must be synchronous"""
        logger.debug(f"Student {self.student_number} received event '{event}': {args}")
        # Return acknowledgment for any event
        return {"status": "received"}

    def on_batch_quizzes_created(self, data):
        """Handle batch_quizzes_created event"""
        if self.student_id:
            self.event_tracker.batch_quizzes_created.add(self.student_id)
        self.latest_batch_quizzes_id = data.get("batch_quizzes_id")
        logger.info(
            f"Student {self.student_number} (ID: {self.student_id}) received batch_quizzes_created: {self.latest_batch_quizzes_id}"
        )
        # Return acknowledgment - must be synchronous function
        return {"status": "received", "student_id": self.student_id}

    def on_batch_quizzes_finished(self, data):
        """Handle batch_quizzes_finished event"""
        if self.student_id:
            self.event_tracker.batch_quizzes_finished.add(self.student_id)
        logger.info(
            f"Student {self.student_number} (ID: {self.student_id}) received batch_quizzes_finished event"
        )
        return {"status": "received", "student_id": self.student_id}

    def on_batch_quizzes_disclosed(self, data):
        """Handle batch_quizzes_disclosed event"""
        if self.student_id:
            self.event_tracker.batch_quizzes_disclosed.add(self.student_id)
        logger.info(
            f"Student {self.student_number} (ID: {self.student_id}) received batch_quizzes_disclosed event"
        )
        return {"status": "received", "student_id": self.student_id}

    def on_batch_quizzes_closed(self, data):
        """Handle batch_quizzes_closed event"""
        if self.student_id:
            self.event_tracker.batch_quizzes_closed.add(self.student_id)
        logger.info(
            f"Student {self.student_number} (ID: {self.student_id}) received batch_quizzes_closed event"
        )
        return {"status": "received", "student_id": self.student_id}

    def on_student_points(self, data):
        """Handle student_points event"""
        if self.student_id:
            self.event_tracker.student_points.add(self.student_id)
        points = data.get("points", 0)
        logger.info(
            f"Student {self.student_number} (ID: {self.student_id}) received student_points: {points} points"
        )
        return {"status": "received", "student_id": self.student_id, "points": points}

    async def connect_socket(self) -> bool:
        """Connect to socket server using verified working configuration"""
        try:
            # WORKING CONFIGURATION from diagnostic test:
            # URL: https://api-swift.classswift-dev.com/sockets/
            # Path: /sockets/socket.io

            base_url = self.socket_url.rstrip("/")
            connect_url = f"{base_url}?role=student&postman=true"

            logger.info(f"Student {self.student_number} connecting to: {connect_url}")

            await self.sio.connect(
                connect_url,
                socketio_path="/sockets",
                transports=["websocket"],
                namespaces=[PARTICIPANT_NS],
                wait_timeout=30,
            )

            # Wait for connection to be established and sid to be available
            for _ in range(50):  # Wait up to 5 seconds
                if self.connected:
                    # Get the namespace-specific sid (this matches the server's sid)
                    # Use get_sid() to get the namespace-specific sid, not self.sio.sid
                    namespace_sid = self.sio.get_sid(PARTICIPANT_NS)
                    if namespace_sid:
                        # Update cached sid for logging
                        self.sid = namespace_sid
                        logger.info(
                            f"✅ Student {self.student_id} connected with SID: {self.sid} (namespace: {PARTICIPANT_NS})"
                        )
                        return True
                await asyncio.sleep(0.1)

            logger.error(f"Student {self.student_number} connection timeout")
            return False

        except Exception as e:
            logger.error(f"Student {self.student_number} connection error: {e}")
            import traceback

            logger.error(traceback.format_exc())
            return False

    async def choose_seat(self, lesson_id: str) -> bool:
        """Choose a seat in the lesson"""
        # Always read namespace-specific sid directly from sio to avoid race condition with reconnection
        # Use get_sid() to get the namespace-specific sid that matches the server's sid
        current_sid = self.sio.get_sid(PARTICIPANT_NS) if self.sio.connected else None

        if not current_sid:
            logger.error(f"Student {self.student_number} has no SID")
            return False

        # Check if still connected before choosing seat
        if not self.sio.connected:
            logger.error(
                f"Student {self.student_number} socket disconnected before choosing seat"
            )
            return False

        url = f"{self.api_url}/api/v3/lessons/{lesson_id}/choose_seat"
        payload = {
            "serial_number": self.student_number,
            "sid": current_sid,  # Use current sid, not cached value
            "device_id": self.device_id,
            "is_incognito": False,
        }

        try:
            logger.info(
                f"Student {self.student_id} choosing seat with SID: {current_sid}"
            )
            response = requests.post(url, json=payload, timeout=30)
            response.raise_for_status()

            data = response.json()
            self.student_id = data["student_id"]
            self.socket_token = data.get("socket_token")
            self.lesson_id = lesson_id  # Store lesson_id for reconnection

            logger.info(
                f"Student {self.student_id} chose seat - "
                f"ID: {self.student_id}, Seat: {data.get('seat_number')}, "
                f"Token: {self.socket_token[:20] if self.socket_token else 'None'}..."
            )

            # Verify socket still connected after seat selection
            await asyncio.sleep(0.5)
            if not self.sio.connected:
                logger.warning(
                    f"⚠️  Student {self.student_number} socket disconnected after choosing seat"
                )
                logger.warning(
                    f"   This might be normal if server expects reconnection with token"
                )
            else:
                logger.info(
                    f"✅ Student {self.student_number} socket still connected after choosing seat"
                )

            return True

        except requests.exceptions.RequestException as e:
            logger.error(f"Student {self.student_number} failed to choose seat: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return False

    def get_latest_batch_quiz(self, lesson_id: str) -> Optional[Dict]:
        """Get latest batch quiz without auth token"""
        if not self.student_id:
            logger.error(f"Student {self.student_number} has no student_id")
            return None

        url = f"{self.api_url}/api/v3/lessons/{lesson_id}/students/{self.student_id}/batch_quizzes/latest"

        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()

            self.quiz_data = response.json()
            logger.info(f"Student {self.student_number} fetched latest batch quiz")
            return self.quiz_data

        except requests.exceptions.RequestException as e:
            logger.error(f"Student {self.student_number} failed to get batch quiz: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return None

    def submit_answers(self, batch_quizzes_id: str) -> bool:
        """Submit answers to batch quiz"""
        if not self.student_id or not self.quiz_data:
            logger.error(f"Student {self.student_number} missing data for submission")
            return False

        url = f"{self.api_url}/api/v3/quizzes/batch_quizzes/{batch_quizzes_id}/batch_quizzes_result"

        # Generate random answers for each quiz
        quizzes = self.quiz_data.get("data", {}).get("quizzes", [])
        answers = []

        for quiz in quizzes:
            quiz_id = quiz.get("quiz_id")
            quiz_type = quiz.get("quiz_type")
            option_list = quiz.get("option_list", [])

            if quiz_type == "TRUE_FALSE":
                answer_data = [random.choice([1, 2])]
            elif quiz_type == "SINGLE_SELECT":
                answer_data = [random.randint(1, len(option_list))]
            elif quiz_type == "MULTIPLE_SELECT":
                num_selections = random.randint(0, min(3, len(option_list)))
                answer_data = (
                    random.sample(range(1, len(option_list) + 1), num_selections)
                    if num_selections > 0
                    else []
                )
            else:
                answer_data = []

            answers.append({"quiz_id": quiz_id, "answer_data": answer_data})

        payload = {"student_id": self.student_id, "answers": answers}

        try:
            response = requests.put(url, json=payload, timeout=30)
            response.raise_for_status()
            logger.info(f"Student {self.student_number} submitted answers")
            return True

        except requests.exceptions.RequestException as e:
            logger.error(f"Student {self.student_number} failed to submit answers: {e}")
            if hasattr(e, "response") and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            return False

    async def disconnect(self):
        """Disconnect from socket"""
        if self.sio.connected:
            await self.sio.disconnect()


async def run_simulation(
    api_url: str,
    socket_url: str,
    room_id: str,
    teacher_token: str,
    collection_id: str,
    num_students: int = 50,
    wait_before_create_batch_quizzes: float = 2.0,
):
    """Run the complete classroom simulation

    Args:
        api_url: API base URL
        socket_url: Socket.IO URL
        room_id: Room UUID
        teacher_token: Teacher's access token
        collection_id: Collection UUID
        num_students: Number of students to simulate
        wait_before_create_batch_quizzes: Wait time in seconds before teacher creates batch quizzes
    """

    logger.info("=" * 80)
    logger.info("Starting Comprehensive Classroom Simulation")
    logger.info(f"API URL: {api_url}")
    logger.info(f"Socket URL: {socket_url}")
    logger.info(f"Room ID: {room_id}")
    logger.info(f"Number of students: {num_students}")
    logger.info(
        f"Wait before creating batch quizzes: {wait_before_create_batch_quizzes}s"
    )
    logger.info("=" * 80)

    event_tracker = EventTracker()

    # Step 1: Teacher creates lesson
    logger.info("\n📝 Step 1: Teacher creating lesson...")
    teacher = Teacher(api_url, teacher_token, room_id, collection_id)
    lesson_id = teacher.create_lesson()

    if not lesson_id:
        logger.error("Failed to create lesson. Aborting simulation.")
        return

    await asyncio.sleep(2)

    # Step 2: Students connect and choose seats
    logger.info(f"\n👥 Step 2: Connecting {num_students} students...")
    students: List[Student] = []

    for i in range(1, num_students + 1):
        student = Student(i, api_url, socket_url, event_tracker)
        students.append(student)

    connect_tasks = [student.connect_socket() for student in students]
    connect_results = await asyncio.gather(*connect_tasks, return_exceptions=True)

    connected_count = sum(1 for result in connect_results if result is True)
    logger.info(f"Connected: {connected_count}/{num_students} students")

    if connected_count == 0:
        logger.error("No students connected. Check socket URL and configuration.")
        return

    await asyncio.sleep(2)

    logger.info(f"\n💺 Step 3: Students choosing seats...")

    # Check how many students are still connected
    connected_students = [s for s in students if s.connected]
    logger.info(
        f"Students still connected before seat selection: {len(connected_students)}/{len(students)}"
    )

    # Choose seats one at a time or in small batches to avoid overwhelming the server
    # This helps prevent "packet queue is empty" errors
    batch_size = 10  # Process 10 students at a time
    seated_count = 0

    for i in range(0, len(connected_students), batch_size):
        batch = connected_students[i : i + batch_size]
        batch_num = (i // batch_size) + 1
        logger.info(f"Processing batch {batch_num} ({len(batch)} students)...")

        seat_tasks = [student.choose_seat(lesson_id) for student in batch]
        seat_results = await asyncio.gather(*seat_tasks, return_exceptions=True)

        batch_seated = sum(1 for result in seat_results if result is True)
        seated_count += batch_seated

        logger.info(f"  Batch {batch_num}: {batch_seated}/{len(batch)} students seated")

        # Small delay between batches
        if i + batch_size < len(connected_students):
            await asyncio.sleep(1)

    logger.info(
        f"Total seated: {seated_count}/{len(connected_students)} students (out of {num_students} total)"
    )

    # Log which students didn't choose seats
    seated_student_numbers = {s.student_number for s in students if s.student_id}
    not_seated = set(range(1, num_students + 1)) - seated_student_numbers
    if not_seated:
        logger.warning(f"⚠️  Students who didn't choose seats: {sorted(not_seated)}")
        # Log details for each student who didn't choose seat
        for student_num in sorted(not_seated):
            student = students[student_num - 1]  # student_number is 1-indexed
            status = []
            if not student.connected:
                status.append("not connected")
            if not student.student_id:
                status.append("no student_id")
            if not student.sid:
                status.append("no sid")
            logger.warning(
                f"   Student {student_num}: {', '.join(status) if status else 'unknown reason'}"
            )

    # Check connection status after seat selection
    await asyncio.sleep(2)
    still_connected = sum(1 for s in students if s.connected)
    logger.info(
        f"Students still connected after seat selection: {still_connected}/{len(students)}"
    )

    if still_connected < seated_count:
        logger.warning(
            f"⚠️  {seated_count - still_connected} students disconnected after choosing seat"
        )
        # Log which students disconnected after choosing seat
        disconnected_after_seat = [
            s.student_number for s in students if s.student_id and not s.connected
        ]
        if disconnected_after_seat:
            logger.warning(
                f"   Disconnected students (had seat): {sorted(disconnected_after_seat)}"
            )

    await asyncio.sleep(2)

    # Wait before teacher creates batch quizzes
    if wait_before_create_batch_quizzes > 0:
        logger.info(
            f"\n⏳ Waiting {wait_before_create_batch_quizzes}s before teacher creates batch quizzes..."
        )
        await asyncio.sleep(wait_before_create_batch_quizzes)

    # Step 4: Teacher creates batch quizzes
    logger.info(f"\n📚 Step 4: Teacher creating batch quizzes...")
    batch_quizzes_id = teacher.create_batch_quizzes(lesson_id)

    if not batch_quizzes_id:
        logger.error("Failed to create batch quizzes. Aborting.")
        return

    # Wait for students to receive event
    await asyncio.sleep(3)
    # Get set of student_ids who chose seats
    seated_student_ids = {s.student_id for s in students if s.student_id}
    event_tracker.assert_all_received(
        "batch_quizzes_created", seated_student_ids, num_students
    )

    # Step 5: Students get quiz and submit answers
    logger.info(f"\n📝 Step 5: Students fetching quiz and submitting answers...")

    # Students get quiz
    get_quiz_tasks = [
        asyncio.to_thread(student.get_latest_batch_quiz, lesson_id)
        for student in students
        if student.student_id
    ]
    await asyncio.gather(*get_quiz_tasks, return_exceptions=True)

    await asyncio.sleep(1)

    # Students submit answers
    submit_tasks = [
        asyncio.to_thread(student.submit_answers, batch_quizzes_id)
        for student in students
        if student.quiz_data
    ]
    submit_results = await asyncio.gather(*submit_tasks, return_exceptions=True)

    submitted_count = sum(1 for result in submit_results if result is True)
    logger.info(f"Submitted: {submitted_count} students")

    await asyncio.sleep(2)

    # Step 6: Teacher finishes quiz
    logger.info(f"\n✅ Step 6: Teacher finishing quiz...")
    teacher.update_batch_quiz_status(lesson_id, batch_quizzes_id, "FINISH")

    await asyncio.sleep(3)
    seated_student_ids = {s.student_id for s in students if s.student_id}
    event_tracker.assert_all_received(
        "batch_quizzes_finished", seated_student_ids, num_students
    )

    # Step 7: Teacher discloses quiz
    logger.info(f"\n🔓 Step 7: Teacher disclosing quiz answers...")
    teacher.disclose_batch_quiz(lesson_id, batch_quizzes_id)

    await asyncio.sleep(3)
    seated_student_ids = {s.student_id for s in students if s.student_id}
    event_tracker.assert_all_received(
        "batch_quizzes_disclosed", seated_student_ids, num_students
    )

    # Step 8: Teacher closes quiz
    logger.info(f"\n🔒 Step 8: Teacher closing quiz...")
    teacher.update_batch_quiz_status(lesson_id, batch_quizzes_id, "CLOSE")

    await asyncio.sleep(3)
    seated_student_ids = {s.student_id for s in students if s.student_id}
    event_tracker.assert_all_received(
        "batch_quizzes_closed", seated_student_ids, num_students
    )

    # Step 9: Teacher adds points
    logger.info(f"\n⭐ Step 9: Teacher adding points to students...")
    student_points = [
        {"student_id": student.student_id, "points": random.randint(10, 20)}
        for student in students
        if student.student_id
    ]

    teacher.add_student_points(lesson_id, student_points)

    await asyncio.sleep(3)
    seated_student_ids = {s.student_id for s in students if s.student_id}
    event_tracker.assert_all_received(
        "student_points", seated_student_ids, num_students
    )

    # Step 10: Cleanup
    logger.info(f"\n🧹 Step 10: Disconnecting students...")
    disconnect_tasks = [student.disconnect() for student in students]
    await asyncio.gather(*disconnect_tasks, return_exceptions=True)

    # Final Summary
    logger.info("\n" + "=" * 80)
    logger.info("🎉 Simulation Completed!")
    logger.info("=" * 80)
    logger.info(f"Lesson ID: {lesson_id}")
    logger.info(f"Batch Quizzes ID: {batch_quizzes_id}")
    logger.info(f"Students connected: {connected_count}/{num_students}")
    logger.info(f"Students seated: {seated_count}/{num_students}")
    logger.info(f"Students submitted answers: {submitted_count}/{num_students}")
    logger.info("\nEvent Reception Summary:")
    logger.info(
        f"  batch_quizzes_created:  {len(event_tracker.batch_quizzes_created)}/{seated_count}"
    )
    logger.info(
        f"  batch_quizzes_finished: {len(event_tracker.batch_quizzes_finished)}/{seated_count}"
    )
    logger.info(
        f"  batch_quizzes_disclosed: {len(event_tracker.batch_quizzes_disclosed)}/{seated_count}"
    )
    logger.info(
        f"  batch_quizzes_closed:   {len(event_tracker.batch_quizzes_closed)}/{seated_count}"
    )
    logger.info(
        f"  student_points:         {len(event_tracker.student_points)}/{seated_count}"
    )
    logger.info("=" * 80)


def main():
    """Main entry point"""

    # ============================================================================
    # CONFIGURATION - Update these values before running
    # ============================================================================

    API_URL = "http://localhost:8000"
    SOCKET_URL = "http://localhost:8000"

    # dev
    # API_URL = "https://api-swift.classswift-dev.com"  # Your API base URL
    # SOCKET_URL = "https://api-swift.classswift-dev.com"  # Your Socket.IO URL (without /sockets path)

    ROOM_ID = "cc40f305-a16a-494c-83fe-ee616c403bce"  # Your room UUID

    TEACHER_TOKEN = "eyJhbGciOiJIUzI1NiIsInRva2VuX3R5cGUiOiJ2aWV3c29uaWMiLCJ0eXAiOiJKV1QifQ.eyJ1c2VyX2lkIjoiZGUwOTZjMmMtMzEyYy00MTEwLThlNTQtOGIwNTkyOTAxNjRjIiwiY2xpZW50X2lkIjoiNmYyNWYzNDAtMzJmMi00ZTVhLWI3ZTgtZTVkZDhkZTgyNzRhIiwidG9rZW4iOiJleUpoYkdjaU9pSlNVekkxTmlJc0luUjVjQ0k2SW1GMEsycDNkQ0lzSW10cFpDSTZJa2xpV1ZCbFQySTBjM2RsVlMxWk5VOVNhbEJuUTJ3MWNYWTFWbTFWVTA1WGFFSlpXRXBmWm5CcUxVVWlmUS5leUpxZEdraU9pSnVObm96YXpCRVgzWkhOMVYyTlVOaFp6QjBPRXdpTENKemRXSWlPaUkwTXpWaVkyRmlNQzB5Tm1ZekxUUTNabU10T1dNeE9DMDVZalEzWmpSaVpEVTJPRGdpTENKcFlYUWlPakUzTmpVek16TTVNemdzSW1WNGNDSTZNVGMyTlRNek56VXpPQ3dpYzJOdmNHVWlPaUp2Y0dWdWFXUWdjSEp2Wm1sc1pTQmxiV0ZwYkNCaFpHUnlaWE56SUc5bVpteHBibVZmWVdOalpYTnpJaXdpWTJ4cFpXNTBYMmxrSWpvaU5tWXlOV1l6TkRBdE16Sm1NaTAwWlRWaExXSTNaVGd0WlRWa1pEaGtaVGd5TnpSaElpd2lhWE56SWpvaWFIUjBjSE02THk5emRHRm5aUzVqYkc5MVpDNTJhV1YzYzI5dWFXTXVZMjl0TDJGMWRHZ3ZkakV2YjJsa1l5SXNJbUYxWkNJNkltaDBkSEJ6T2k4dmMzUmhaMlV1WTJ4dmRXUXVkbWxsZDNOdmJtbGpMbU52YlNKOS5ocjhrNlBOeXVOV2plempRTTJUVlVKNm1aN1NjX0Y2MjJOdUowMTROcHJPZkhiSVJZeVM4WHVPLS1UMHhDMl9DeGlJVlhfbmhUSGQ5U2FTd2VaYTk1U0F5alZpTWpjeXFfRGFFVE9KQ0FvT1pJMnpZQi1OTHhWckgwZktvcjFZLXlLRU9acS1tbDhvMk9kd2c2V0FYNW9tMXE5cUtHVUcwMlRwY1FMdzd1UVNzd29YMDBlQlg4RV9OcjBCQXg5Njc5b25yR0llRWV0NVNiUGZERXdOWFdoSldWRDlja1FWN3R1amhpczlyVDZoWWJzZXVRT2ZuNFdLM1hKR3lpSW5tZm92dGdOMk1zVElBMGVXVjdCMUo0Qk1uOUExXzNCUEpobUtUNUZOTkROZkdpYkxMN1JKVmEwbGlKeTdsMHNJeGQ3eDk0cmNRcGNrX3dTVi1USlY0WGciLCJleHAiOjE3NjU0MjAzMzh9.UdE0DTPsZXqUaSNsP9BjLYtDLU5j-52TzgMguYDIFME"  # Teacher's access token

    COLLECTION_ID = "b807f105-9835-4926-a17e-6e342d6f9841"  # Your collection UUID

    # stage
    # API_URL = "https://api-swift.aps1.classswift-stg.com"  # Your API base URL
    # SOCKET_URL = "https://api-swift.aps1.classswift-stg.com"  # Your Socket.IO URL (without /sockets path)

    # ROOM_ID = "40c9a47d-2911-4150-b1e8-8992dff8936c"  # Your room UUID

    # TEACHER_TOKEN = "eyJhbGciOiJIUzI1NiIsInRva2VuX3R5cGUiOiJ2aWV3c29uaWMiLCJ0eXAiOiJKV1QifQ.eyJ1c2VyX2lkIjoiZGUwOTZjMmMtMzEyYy00MTEwLThlNTQtOGIwNTkyOTAxNjRjIiwiY2xpZW50X2lkIjoiNmYyNWYzNDAtMzJmMi00ZTVhLWI3ZTgtZTVkZDhkZTgyNzRhIiwidG9rZW4iOiJleUpoYkdjaU9pSlNVekkxTmlJc0luUjVjQ0k2SW1GMEsycDNkQ0lzSW10cFpDSTZJa2xpV1ZCbFQySTBjM2RsVlMxWk5VOVNhbEJuUTJ3MWNYWTFWbTFWVTA1WGFFSlpXRXBmWm5CcUxVVWlmUS5leUpxZEdraU9pSmZVVTVLUmpkd1kwWjVWVmg0YkZoeFVsWnNla3NpTENKemRXSWlPaUkwTXpWaVkyRmlNQzB5Tm1ZekxUUTNabU10T1dNeE9DMDVZalEzWmpSaVpEVTJPRGdpTENKcFlYUWlPakUzTmpVME5EQTJNamdzSW1WNGNDSTZNVGMyTlRRME5ESXlPQ3dpYzJOdmNHVWlPaUp2Y0dWdWFXUWdjSEp2Wm1sc1pTQmxiV0ZwYkNCaFpHUnlaWE56SUc5bVpteHBibVZmWVdOalpYTnpJaXdpWTJ4cFpXNTBYMmxrSWpvaU5tWXlOV1l6TkRBdE16Sm1NaTAwWlRWaExXSTNaVGd0WlRWa1pEaGtaVGd5TnpSaElpd2lhWE56SWpvaWFIUjBjSE02THk5emRHRm5aUzVqYkc5MVpDNTJhV1YzYzI5dWFXTXVZMjl0TDJGMWRHZ3ZkakV2YjJsa1l5SXNJbUYxWkNJNkltaDBkSEJ6T2k4dmMzUmhaMlV1WTJ4dmRXUXVkbWxsZDNOdmJtbGpMbU52YlNKOS5MYVhvQjE2ZkNkS0U3anhaaGRPOXI1bm1uNTZvZVhab0YxdVJ1ZWd6cHgxQWprM0xaM1VXWnJhWEVfOWM1UXJ3WElLa3pmMjVqUmY3X3puS1FWS2VOQjV4VGlCRUFFYkJjcjdTUy1WejZuaWVvbGwwMUUybWtSeWpNLXdHQWhmcWV2VC1XT0plX2xVTzFLdW9SYTVzOWZadm8zeDdMRWhncm5XVlFlNmVsa2ZlM1VPaEdaeVl2MC1fYU9jMDY1UDlpcnNKLXg5cU1rLXRUWTVCZ0pQYkowakkxUGR0bnp2OHdGNklGaUlSdVc5N0ZOUHNRb0ZnRk15OUJDQzlhd1NQMHo4d1Zwc0YwYm9EMWRvQ2FDWHZROWJtMmxnSHJQMEVvQzI5Mi1VRVl5Vl9OTkNRVmRuWWR2eVVIS0hfNHNtMkxxb3M5REI1elNuOWFqM05aZEZ5dkEiLCJleHAiOjE3NjU1MjcwMjh9.THD69kgH0gBkCiqVisWkKGPI5KK67GCgaRBrAOdEDPo"  # Teacher's access token

    # COLLECTION_ID = "8be2708d-62e6-43fc-954e-3514ffadfb6c"  # Your collection UUID

    NUM_STUDENTS = 50  # Number of students to simulate

    # Wait time configuration (in seconds)
    WAIT_BEFORE_CREATE_BATCH_QUIZZES = (
        10.0  # Wait time before teacher creates batch quizzes
    )

    # ============================================================================
    # END CONFIGURATION
    # ============================================================================

    logger.info("Configuration loaded:")
    logger.info(f"  API URL: {API_URL}")
    logger.info(f"  Socket URL: {SOCKET_URL}")
    logger.info(f"  Room ID: {ROOM_ID}")
    logger.info(f"  Collection ID: {COLLECTION_ID}")
    logger.info(f"  Number of students: {NUM_STUDENTS}")
    logger.info(
        f"  Wait before creating batch quizzes: {WAIT_BEFORE_CREATE_BATCH_QUIZZES}s"
    )
    logger.info("")

    asyncio.run(
        run_simulation(
            api_url=API_URL,
            socket_url=SOCKET_URL,
            room_id=ROOM_ID,
            teacher_token=TEACHER_TOKEN,
            collection_id=COLLECTION_ID,
            num_students=NUM_STUDENTS,
            wait_before_create_batch_quizzes=WAIT_BEFORE_CREATE_BATCH_QUIZZES,
        )
    )


if __name__ == "__main__":
    main()
