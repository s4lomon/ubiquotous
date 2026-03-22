cmake_minimum_required(VERSION 3.16)
project(BesaBridge CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ─── Paths exatos do Homebrew (arm64 Mac) ────────────────────
set(BOOST_ROOT      /opt/homebrew/opt/boost)
set(LSL_ROOT        /opt/homebrew/opt/lsl)

# ─── Boost ───────────────────────────────────────────────────
set(Boost_NO_SYSTEM_PATHS ON)
find_package(Boost 1.74 REQUIRED COMPONENTS thread)

# ─── liblsl (paths fixos) ────────────────────────────────────
set(LSL_INCLUDE_DIR ${LSL_ROOT}/include)
set(LSL_LIBRARY     ${LSL_ROOT}/lib/liblsl.dylib)

if(NOT EXISTS ${LSL_LIBRARY})
    # Tenta .a estático se .dylib não existir
    set(LSL_LIBRARY ${LSL_ROOT}/lib/liblsl.a)
endif()

message(STATUS "Boost: ${BOOST_ROOT}")
message(STATUS "liblsl header: ${LSL_INCLUDE_DIR}")
message(STATUS "liblsl lib:    ${LSL_LIBRARY}")

# ─── Executável ──────────────────────────────────────────────
add_executable(besa_bridge main.cpp)

target_include_directories(besa_bridge PRIVATE
    ${Boost_INCLUDE_DIRS}
    ${LSL_INCLUDE_DIR}
)

target_link_libraries(besa_bridge
    ${Boost_LIBRARIES}
    ${LSL_LIBRARY}
    "-framework CoreFoundation"
)