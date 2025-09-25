import asyncio
import websockets
import json
import serial
from websockets.protocol import State

# ===== UART CONFIG =====
ser = serial.Serial("COM5", 115200, timeout=1)  # COM5

connected_client = None
board = {i: "Empty" for i in range(1, 13)}
rows, cols = 4, 3
stop_path = False

# ===== Hàm tạo packet UART cố định 12 byte =====
def build_packet(data_bytes):
    HEADER = 0xAA
    LEN = 12
    # Nếu data_bytes < 12, điền thêm 0
    data_bytes = data_bytes[:12] + [0]*(12 - len(data_bytes))
    checksum = (HEADER + LEN + sum(data_bytes)) & 0xFF
    packet = bytes([HEADER, LEN] + data_bytes + [checksum])
    return packet

def get_neighbors(cell):
    r = (cell - 1) // cols
    c = (cell - 1) % cols
    neighbors = []
    valid_cells = ["Empty", "Real", "R1"]

    if c - 1 >= 0:
        left_cell = r * cols + (c - 1) + 1
        if board[left_cell] in valid_cells:
            neighbors.append(left_cell)
    if c + 1 < cols:
        right_cell = r * cols + (c + 1) + 1
        if board[right_cell] in valid_cells:
            neighbors.append(right_cell)
    if r + 1 < rows:
        down_cell = (r + 1) * cols + c + 1
        if board[down_cell] in valid_cells:
            neighbors.append(down_cell)
    return neighbors

def bfs_prioritize_real(start_cells, end_cells, min_real=2):
    path_queue = []
    for start in start_cells:
        queue = [(start, [start], 1 if board[start] == "Real" else 0, 1 if board[start] == "R1" else 0)]
        visited_paths = set()

        while queue:
            current, path, real_count, r1_used = queue.pop(0)
            key = (tuple(path), r1_used)
            if key in visited_paths:
                continue
            visited_paths.add(key)

            if current in end_cells and real_count >= min_real:
                path_queue.append((real_count, len(path), path))
                continue

            neighbors = get_neighbors(current)
            def sort_key(x):
                if board[x] == "Real": return 0
                elif board[x] == "Empty": return 1
                elif board[x] == "R1" and r1_used == 0: return 2
                else: return 3
            neighbors.sort(key=sort_key)

            for n in neighbors:
                if n not in path and board[n] != "Fake":
                    new_r1_used = r1_used + 1 if board[n] == "R1" else r1_used
                    if new_r1_used <= 1:
                        queue.append((n, path + [n], real_count + (1 if board[n] == "Real" else 0), new_r1_used))

    path_queue.sort(key=lambda x: (-x[0], x[1]))
    return [p for _, _, p in path_queue]

async def handle_path(ws, path):
    global stop_path
    if stop_path:
        return

    # ==== Gửi path qua UART 12 byte =====
    try:
        packet = build_packet(path)
        ser.write(packet)
        print("✅ Đã gửi packet qua UART:", list(packet))
    except Exception as e:
        print("❌ UART Error:", e)

    # ==== In ra bảng 12 ô hiện tại ====
    full_board = [board.get(i, "Empty") for i in range(1, 13)]
    print("🖥️ Bảng 12 ô hiện tại:", full_board)

    # ==== Gửi full path cho WebSocket client ====
    if ws.state == State.OPEN:
        await ws.send(json.dumps({"full_path": path}))

async def game_server(ws):
    global connected_client, board, stop_path

    if connected_client and connected_client.state == State.OPEN:
        await ws.send("Server chỉ cho phép 1 client thôi!")
        await ws.close()
        return

    connected_client = ws
    print("Client connected:", ws.remote_address)
    print("Bảng hiện tại:", json.dumps(board))

    try:
        async for message in ws:
            print("Received:", message)
            try:
                data = json.loads(message)
            except:
                data = None

            if data and data.get("action") == "start":
                stop_path = True
                await asyncio.sleep(0.1)
                stop_path = False

                squares = data.get("squares", {})
                for k, v in squares.items():
                    board[int(k)] = v
                print("Bảng sau khi start:", json.dumps(board))

                start_cells = [i for i in range(1, 4) if board[i] in ["Empty", "Real", "R1"]]
                end_cells = [i for i in range(10, 13) if board[i] in ["Empty", "Real", "R1"]]

                path_queue = bfs_prioritize_real(start_cells, end_cells, min_real=2)

                if path_queue:
                    path = path_queue[0]
                    print("Đường đi hợp lệ:", path)
                    asyncio.create_task(handle_path(ws, path))
                else:
                    print("❌ Không tìm được đường đi hợp lệ!")
                continue

            if data and data.get("action") == "retry":
                stop_path = True
                board = {i: "Empty" for i in range(1, 13)}
                if ws.state == State.OPEN:
                    await ws.send(json.dumps({"server_msg": "Board reset for retry"}))
                continue

            await ws.send(json.dumps({"server_msg": message}))

    except websockets.exceptions.ConnectionClosedOK:
        pass
    except websockets.exceptions.ConnectionClosedError:
        pass
    finally:
        print("Client disconnected:", ws.remote_address)
        connected_client = None
        stop_path = True

async def main():
    async with websockets.serve(game_server, "0.0.0.0", 8765):
        print("Caro WebSocket server running on port 8765 (1 client only)")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
