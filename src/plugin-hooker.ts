import * as Rx from "rxjs/Rx";

/**
 * A function that loads an extension from a package
 * @param pkg - a package containing the extension to be loaded
 * @param extInfo - a description of the extension to be loaded
 */
export type Loader = (extInfo: IExtensionInfo) => Promise<any>;

/**
 * A function which handles an error
 */
export type ErrorHandler = (err: Error) => void;

/**
 * A function which accepts a list of packages
 * @param packages - the current set of packages from the finder
 */
export type PackageListener = (packages: IPackage[]) => void;

/**
 * Cancel the watch action
 */
export type WatchCancellationFunction = () => void;

export type Extension = IExtensionInfo & { packageId: string; value: any; error?: Error };

export interface IPackage {
    /** A unique identifier for the package */
    id: string;
    /** The packages's metadata */
    metadata: IPackageMetadata;
    /** Extensions that the package contains */
    extensions: IExtensionInfo[];
    /** A loader  */
    load: Loader;
}

export interface IExtensionInfo {
    hook: string;
    name: string;
    [index: string]: any;
}

export interface IPackageMetadata {
    /** The name of the package */
    name: string;
    /** The package author */
    author?: string;
    /** The package version */
    version?: string;
    /** A description of the package */
    summary?: string;
}

export interface IPackageFinder {
    /**
     * Watch for new packages.
     * Invoke the given function initially and then each time a new set of packages
     * is received.
     */
    watch(listener: PackageListener): WatchCancellationFunction;

    /** Return a static list of all packages found */
    find(): Promise<IPackage[]>;
}

export class PluginHooker {
    /**
     * Get a list of extensions which implement a hook
     */
    private static async getImplementations(packages: IPackage[], hook: string): Promise<Extension[]> {
        const extensions: Extension[] = [];
        for (const pkg of packages) {
            const contents = pkg.extensions
                .filter((extInfo) => extInfo.hook === hook);

            for (const extInfo of contents) {
                try {
                    extensions.push({
                        ...extInfo,
                        packageId: pkg.id,
                        value: await pkg.load(extInfo),
                    });
                } catch (err) {
                    extensions.push({
                        ...extInfo,
                        error: err,
                        packageId: pkg.id,
                        value: null,
                    });
                }
            }
        }
        return extensions;
    }

    private activeWatch?: { close: WatchCancellationFunction, subject: Rx.BehaviorSubject<IPackage[]>};

    constructor(private finder: IPackageFinder) { }

    /**
     * Watch for extensions that implement a hook and emit
     * them in batches whenever the underlying configuration changes
     */
    public watch(hook: string): Rx.Observable<Extension[]> {
        return this.packageSubject
            .mergeMap((packages) => PluginHooker.getImplementations(packages, hook));
    }

    /**
     * Load all the plugins which implement a hook without installing a
     * watcher (does not affect previously installed watchers)
     */
    public async load(hook: string) {
        return await PluginHooker.getImplementations(await this.finder.find(), hook);
    }

    /**
     * Stop watchig the plugin environment for package changes.
     */
    public stopWatching() {
        if (this.activeWatch) {
            this.activeWatch.close();
            delete this.activeWatch;
        }
    }

    /**
     * Return an Rx.Observable that emits a list of metadata for all of the
     * packages everytime the plugin metadata changes.
     */
    public get packagesStream(): Rx.Observable<IPackageMetadata[]> {
        return this.packageSubject
            .map((packages: IPackage[]) => packages.map((pkg: IPackage) => pkg.metadata));
    }

    /**
     * Return whether the finder is currently being watched for packages/extensions.
     */
    public get isWatching(): boolean {
        return this.activeWatch !== undefined;
    }

    private get packageSubject() {
        if (this.activeWatch) {
            return this.activeWatch.subject;
        }

        const subject = new Rx.BehaviorSubject([] as IPackage[]);
        const close = this.finder.watch((packages: IPackage[]) => subject.next(packages));
        this.activeWatch = {close, subject};
        return subject;
    }
}
