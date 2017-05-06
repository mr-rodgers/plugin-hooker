/// <reference types="systemjs" />

declare namespace Jspm {
    interface Jspm {
        setPackagePath(packagePath: string): void;
        import(moduleName: string, parentName?: string): Promise<any>;
        import<TModule>(module: string, parentName?: string): Promise<TModule>;
        normalize(moduleName: string, parentName?: string): Promise<string>;

        Loader: SystemJSLoader.System;
    }
}

declare module "jspm" {
    import jspmNS = Jspm;
    const jspm: jspmNS.Jspm;
    export = jspm;
}