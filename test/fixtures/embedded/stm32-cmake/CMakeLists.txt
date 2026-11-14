cmake_minimum_required(VERSION 3.22)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)

# Setup compiler settings before project()
set(CMAKE_PROJECT_NAME blink_g0)
include("cmake/gcc-arm-none-eabi.cmake")

enable_language(C ASM)
project(${CMAKE_PROJECT_NAME})

add_executable(${CMAKE_PROJECT_NAME} Core/Src/main.c Core/Src/startup.c)
target_link_options(${CMAKE_PROJECT_NAME} PRIVATE -T${CMAKE_SOURCE_DIR}/link.ld -nostartfiles -Wl,--gc-sections)
