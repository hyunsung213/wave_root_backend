"""RDK X5 gateway: ESP32 serial input -> smart farm backend.

Required environment variables:
  BACKEND_API_URL=http://<BACKEND_IP>:5000/api/rdk/logs
  PLANT_ID=<MongoDB Plant ObjectId>
  RDK_API_KEY=<same value as backend RDK_API_KEY in production>
"""

import json
import os
import threading
import time
from collections import deque

import requests
import serial
from flask import Flask, jsonify

app = Flask(__name__)

BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "")
PLANT_ID = os.environ.get("PLANT_ID", "")
SERIAL_PORT = os.environ.get("SERIAL_PORT", "/dev/ttyUSB0")
SERIAL_BAUD_RATE = int(os.environ.get("SERIAL_BAUD_RATE", "115200"))
GATEWAY_PORT = int(os.environ.get("GATEWAY_PORT", "5001"))
RDK_API_KEY = os.environ.get("RDK_API_KEY", "")

# 2-second samples x 150 = the most recent five minutes.
data_buffer = deque(maxlen=150)
data_lock = threading.Lock()
latest_data = {
    "degree": None,
    "moisture_air": None,
    "moisture_soil": None,
    "rux": None,
    "timestamp": 0,
}


def read_number(sensor_value, key, *, required=True):
    value = sensor_value.get(key)
    if value is None and not required:
        return None
    if value is None:
        raise ValueError(f"{key} is missing")
    return float(value)


def normalise_sensor_data(raw_data):
    """Reject malformed serial messages before they contaminate the average."""
    return {
        "degree": read_number(raw_data, "degree"),
        "moisture_air": read_number(raw_data, "moisture_air"),
        "moisture_soil": read_number(raw_data, "moisture_soil"),
        "rux": read_number({"rux": raw_data.get("rux", raw_data.get("lux"))}, "rux", required=False),
    }


def read_from_esp32():
    """Continuously read one JSON sensor message at a time from the ESP32."""
    while True:
        try:
            with serial.Serial(SERIAL_PORT, SERIAL_BAUD_RATE, timeout=2) as serial_port:
                print(f"ESP32 serial connection established: {SERIAL_PORT}")
                while True:
                    line = serial_port.readline().decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    try:
                        sample = normalise_sensor_data(json.loads(line))
                    except (json.JSONDecodeError, ValueError, TypeError) as error:
                        print(f"Invalid ESP32 sensor data ({error}): {line}")
                        continue

                    sample["timestamp"] = int(time.time())
                    with data_lock:
                        latest_data.update(sample)
                        data_buffer.append(sample)
        except (serial.SerialException, OSError) as error:
            print(f"ESP32 serial connection error: {error}. Retrying in 5 seconds.")
            time.sleep(5)


def calculate_average(samples, key):
    values = [sample[key] for sample in samples if sample[key] is not None]
    return round(sum(values) / len(values), 2) if values else None


def send_average_to_backend():
    """Every 10 minutes, send the average of the latest five-minute sample window."""
    while True:
        time.sleep(600)
        with data_lock:
            samples = list(data_buffer)

        if not samples:
            print("No buffered sensor data; skipping backend upload.")
            continue
        if not BACKEND_API_URL or not PLANT_ID:
            print("RDK gateway configuration is incomplete; skipping backend upload.")
            continue

        payload = {
            "plantId": PLANT_ID,
            "degree": calculate_average(samples, "degree"),
            "moisture_air": calculate_average(samples, "moisture_air"),
            "moisture_soil": calculate_average(samples, "moisture_soil"),
            "rux": calculate_average(samples, "rux"),
        }
        if payload["rux"] is None:
            del payload["rux"]

        try:
            headers = {"X-RDK-API-Key": RDK_API_KEY} if RDK_API_KEY else {}
            response = requests.post(BACKEND_API_URL, json=payload, headers=headers, timeout=5)
            response.raise_for_status()
            print(f"Average sensor data sent to backend (HTTP {response.status_code}).")
        except requests.RequestException as error:
            print(f"Backend upload failed: {error}")


@app.get("/api/rdk/current")
def get_current_sensor_data():
    """Return an in-memory reading immediately; it does not wait for the 10-minute upload."""
    with data_lock:
        sensor = latest_data.copy()

    if not sensor["timestamp"]:
        return jsonify(success=False, message="No sensor value has been received yet."), 503
    return jsonify(success=True, sensor=sensor), 200


if __name__ == "__main__":
    threading.Thread(target=read_from_esp32, daemon=True).start()
    threading.Thread(target=send_average_to_backend, daemon=True).start()
    print(f"RDK X5 gateway started on port {GATEWAY_PORT}.")
    app.run(host="0.0.0.0", port=GATEWAY_PORT, threaded=True)
