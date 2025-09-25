import serial
import time

# Mở cổng COM
ser = serial.Serial("COM5", 115200, timeout=1)

HEADER = 0xAA
LEN = 12  # giữ cố định 12 byte data

def build_packet(data_bytes):
    """
    Tạo gói UART: HEADER + len + data + checksum
    """
    checksum = (HEADER + LEN + sum(data_bytes)) & 0xFF
    packet = bytes([HEADER, LEN] + data_bytes + [checksum])
    return packet

# Ví dụ dữ liệu thay đổi theo thứ tự 1-12
data_sequence = [
    [1,2,3,4,5,6,7,8,9,10,11,12],
    [12,11,10,9,8,7,6,5,4,3,2,1],
    [5,6,7,8,1,2,3,4,9,10,11,12],
]

while True:
    for data in data_sequence:
        packet = build_packet(data)
        ser.write(packet)
        print(f"Sent packet: {data} -> checksum: {packet[-1]}")
        time.sleep(0.5)
