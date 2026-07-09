#pragma once
// Minimal flush-on-write logger → perfect-map-asi.log next to the host exe. KERNEL32 only, no CRT (the whole
// ASI links -nostdlib). Flush-on-write so a crash still shows the last attempted patch (blind-patch debugging).
#include <windows.h>
#include <cstdint>

namespace pm {

// Fill `out` with the host exe's directory (trailing separator); "./" on failure.
inline void HostDir(char* out, DWORD size) {
  DWORD n = GetModuleFileNameA(nullptr, out, size);
  if (n == 0 || n >= size) {
    out[0] = '.';
    out[1] = '\\';
    out[2] = '\0';
    return;
  }
  for (DWORD i = n; i > 0; --i) {
    if (out[i - 1] == '\\' || out[i - 1] == '/') {
      out[i] = '\0';
      return;
    }
  }
}

class Log {
 public:
  void Open() {
    char path[MAX_PATH];
    HostDir(path, sizeof(path));
    lstrcatA(path, "perfect-map-asi.log");
    file_ = CreateFileA(path, GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL,
                        nullptr);
  }

  void Line(const char* text) {
    Write(text);
    Write("\r\n");
  }

  // "<key>0xXXXXXXXX" on its own line.
  void KeyHex(const char* key, uint32_t value) {
    char hex[11] = {'0', 'x'};
    const char* digits = "0123456789abcdef";
    for (int i = 7; i >= 0; --i) {
      hex[2 + i] = digits[value & 0xF];
      value >>= 4;
    }
    hex[10] = '\0';
    Write(key);
    Line(hex);
  }

  void Close() {
    if (file_ != INVALID_HANDLE_VALUE) {
      CloseHandle(file_);
      file_ = INVALID_HANDLE_VALUE;
    }
  }

 private:
  HANDLE file_ = INVALID_HANDLE_VALUE;

  void Write(const char* text) {
    if (file_ == INVALID_HANDLE_VALUE) {
      return;
    }
    DWORD len = 0;
    while (text[len]) {
      ++len;
    }
    DWORD written = 0;
    WriteFile(file_, text, len, &written, nullptr);
    FlushFileBuffers(file_);
  }
};

}  // namespace pm
