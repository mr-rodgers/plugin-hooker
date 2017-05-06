import * as _fs from "fs";
import * as jspm from "jspm";
import * as path from "path";
import promisify =  require("promisify-node");
import * as url from "url";
import { IExtensionInfo, IPackage, IPackageFinder, PackageListener } from "../plugin-hooker";

const fs = promisify(_fs, undefined, true);

/**
 * A Package Finder that uses JSPM to find packages
 * in a NodeJS environment.
 *
 * Packages must be installed using JSPM
 *
 * Important: only one of these can work at a time. Using
 * this to scan multiple directories is not supported.
 */
export class Jspm implements IPackageFinder {
    constructor(private pluginDir: string) {
        jspm.setPackagePath(this.pluginDir);
    }

    public watch(dispatch: PackageListener) {
        const watcher = fs.watch(
            path.join(this.pluginDir, "package.json"),
            {recursive: true, persistent: false},
        );
        // Emit the initial list first
        this.find()
            .then(dispatch)
            .then(() => watcher.on("change", () => this.find().then(dispatch)));
        return () => watcher.close();
    }

    public async find(): Promise<IPackage[]> {
        // Scan package.json for dependencies and load them using JSPM
        const packageNames = await this.getPackageNames();
        const packages = await Promise.all(packageNames.map((pkgName) => this.getPackage(pkgName)));
        return packages.filter((pkg) => pkg !== null) as IPackage[];
    }

    private async getPackageNames() {
        const packageMetadata = await this.getPackageMetadata(this.pluginDir);
        return Object.keys(((packageMetadata || {}).jspm || {}).dependencies || {});
    }

    private async getPackage(packageName: string): Promise<IPackage | null> {
        const packageDir = await this.findPackageDir(packageName);
        if (packageDir === null) {
            return null;
        }
        const metadata = await this.getPackageMetadata(packageDir);
        const extensions: IExtensionInfo[] = (metadata.extensions || [])
            .map((extInfo: any) => ({...extInfo, name: extInfo.module}));

        return {
            ...{extensions},
            id: packageName,
            load: this.getLoader(),
            metadata: {
                author: metadata.author,
                name: metadata.name,
                summary: metadata.description,
                version: metadata.version,
            },
        };
    }

    private async getPackageMetadata(folder: string) {
        const packageJsonPath = path.join(folder, "package.json");
        const packageJsonContents = await fs.readFile(packageJsonPath, "utf8");
        return JSON.parse(packageJsonContents);
    }

    private async findPackageDir(packageName: string): Promise<string | null> {
        const packageUrl = await jspm.normalize(packageName);
        const parsedPackageUrl = url.parse(packageUrl);

        if (parsedPackageUrl.protocol !== "file:" || !parsedPackageUrl.pathname) {
            return null;
        }

        // Windows work around
        let curPath = process.platform === "win32"
            ? path.normalize(parsedPackageUrl.pathname.slice(1))
            : path.normalize(parsedPackageUrl.pathname);

        const pluginPath = path.resolve(this.pluginDir);

        while (this.isChildOf(pluginPath, curPath)) {
            // Check that this path has a package.json
            const packageJsonPath = path.join(curPath, "package.json");
            if (fs.existsSync(packageJsonPath)) {
                return curPath;
            }

            curPath = path.dirname(curPath);
        }

        return null;
    }

    private isChildOf(parent: string, child: string) {
        return (child !== parent) && parent.split(path.sep).every((t, i) => child.split(path.sep)[i] === t)
    }

    private getLoader() {
        return async (extInfo: IExtensionInfo) => {
            const mod = await jspm.import(extInfo.module);
            return mod[extInfo.export || "default"];
        };
    }
}
