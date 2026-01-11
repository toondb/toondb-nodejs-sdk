// Type definitions for ffi-napi
declare module 'ffi-napi' {
    export function Library(libPath: string, functions: Record<string, any>): any;
    export function ForeignFunction(ptr: any, retType: any, argTypes: any[]): any;
    export class DynamicLibrary {
        constructor(path: string);
        get(symbol: string): any;
    }
}

// Type definitions for ref-napi
declare module 'ref-napi' {
    export const types: {
        void: any;
        uint8: any;
        uint64: any;
        int32: any;
        float: any;
        size_t: any;
        CString: any;
    };
    export const NULL: any;
    export function alloc(type: any, value?: any): any;
    export function refType(type: any): any;
    export function reinterpret(buffer: any, size: number): Buffer;
}

// Type definitions for ref-struct-napi  
declare module 'ref-struct-napi' {
    function StructType(fields: Record<string, any>): any;
    export = StructType;
}
