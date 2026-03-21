cmake_minimum_required(VERSION 3.16)
project(muse LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
find_package(Qt6 REQUIRED COMPONENTS Core Bluetooth)

qt6_standard_project_setup()
qt6_add_executable(muse main.cpp)
target_link_libraries(muse Qt6::Core Qt6::Bluetooth)