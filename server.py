import asyncio
import websockets
import json
from websockets.protocol import State

connected_client = None  # chỉ 1 client
board = {i: "Empty" for i in range(1, 13)}
rows, cols = 4, 3  # 4 hàng x 3 cột
stop_path = False  # flag để dừng dẫn đường

def get_neighbors(cell):
    """Trả về các ô kề hợp lệ: ngang trái, ngang phải, xuống"""
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
    """Tìm đường đi ưu tiên lấy Real nhanh nhất, tối thiểu min_real, chỉ 1 R1"""
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
                if board[x] == "Real":
                    return 0
                elif board[x] == "Empty":
                    return 1
                elif board[x] == "R1" and r1_used == 0:
                    return 2
                else:
                    return 3  # né Fake và R1 đã dùng

            neighbors.sort(key=sort_key)

            for n in neighbors:
                if n not in path and board[n] != "Fake":
                    new_r1_used = r1_used + 1 if board[n] == "R1" else r1_used
                    if new_r1_used <= 1:  # chỉ đi 1 R1
                        queue.append((n, path + [n], real_count + (1 if board[n] == "Real" else 0), new_r1_used))

    # Sắp xếp: nhiều Real nhất → đường ngắn nhất
    path_queue.sort(key=lambda x: (-x[0], x[1]))
    return [p for _, _, p in path_queue]

async def prompt_cell(cell):
    loop = asyncio.get_event_loop()
    while not stop_path:
        input_cell = await loop.run_in_executor(None, input, f"Nhập ô {cell} đã đi xong: ")
        if stop_path:
            return None
        if input_cell.isdigit() and int(input_cell) == cell:
            return int(input_cell)
        print("❌ Ô không hợp lệ hoặc sai thứ tự! Hãy nhập lại.")
    return None

async def handle_path(ws, path):
    global stop_path
    for cell in path:
        if stop_path:
            print("🚫 Path traversal stopped by retry/start!")
            break
        print(f"Waiting ô cần nhập: {cell}")
        result = await prompt_cell(cell)
        if result is None:
            break
        print(f"✅ Đã đi ô: {cell}")
        if ws.state == State.OPEN:
            await ws.send(json.dumps({"visited": cell}))
    print("🎉 Đã dẫn hết đường hợp lệ hoặc bị dừng!")

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
