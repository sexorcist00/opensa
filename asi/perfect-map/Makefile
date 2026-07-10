# perfect-map.asi — MinGW-w64 cross build (macOS → Win32 i386). Wrapped by `npm run build:asi`.
# Requires: brew install mingw-w64  (provides i686-w64-mingw32-g++).

CXX      := i686-w64-mingw32-g++
SRC      := src/dllmain.cpp src/freestanding.cpp
OUT_DIR  := dist
OUT      := $(OUT_DIR)/perfect-map.asi

# 32-bit (SA is i386); C++17; no CRT (the ASI uses Win32 APIs only) so the import table is KERNEL32-only and it
# loads on any Windows SA runs on; DllMain is the raw DLL entry; strip.
# -fno-tree-loop-distribute-patterns: keep our freestanding memset/strlen loops from being rewritten into calls
# to themselves (there is no libc to fall back to under -nostdlib).
CXXFLAGS := -std=c++17 -O2 -Wall -Wextra -fno-exceptions -fno-rtti -fno-tree-loop-distribute-patterns
LDFLAGS  := -shared -nostdlib -Wl,--entry,_DllMain@12 -Wl,--exclude-all-symbols -s

# `npm run build:asi` = the shipping build: APPLY with both fixes on (int16 + fx2dfx, per the PM_FIX_* defaults).
# `make APPLY=1` alone builds the same; plain `make` (build:verify) is the plan-003 dry-run that patches nothing.
# Per-fix bisection: `make APPLY=1 PM='-DPM_FIX_INT16=1 -DPM_FIX_FX2DFX=0'`.
ifeq ($(APPLY),1)
CXXFLAGS += -DPM_APPLY=1
endif
# `make DEBUG=1` (build:debug): verbose log — dump every patch site's verify status before applying + trace the
# int16 sidecar and fx2dfx guard hits at runtime.
ifeq ($(DEBUG),1)
CXXFLAGS += -DPM_DEBUG=1 -DPM_INT16_LOG=1 -DPM_FX2DFX_LOG=1
endif
CXXFLAGS += $(PM)

HDRS     := $(wildcard src/*.hpp) src/generated/patches.hpp

.PHONY: all clean

all: $(OUT)

$(OUT): $(SRC) $(HDRS) | $(OUT_DIR)
	$(CXX) $(CXXFLAGS) $(SRC) -o $(OUT) $(LDFLAGS) -lkernel32
	@echo "built $(OUT)"

$(OUT_DIR):
	@mkdir -p $(OUT_DIR)

clean:
	@rm -rf $(OUT_DIR)
