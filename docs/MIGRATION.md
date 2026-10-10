# Migration guide

## Core WASM ABI 2

The core/text/grid/rich-text boundaries now return primitive data. Update raw WASM
consumers using the shapes in [WASM.md](WASM.md#core-abi-2-migration), particularly
flat `Uint32Array` coordinates, `JSON.parse(block.serialize())`, decoded `splitAt()`
results, and tagged error strings. The core ABI check is 2 and rejects cached ABI 1.
Select and menu keep their independent ABIs. Browser binding APIs are unchanged;
editor and grid continue to use JS.

