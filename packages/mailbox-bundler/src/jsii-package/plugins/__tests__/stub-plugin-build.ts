import type { BuildResult, ImportKind, Message, OnResolveArgs, Plugin, PluginBuild } from 'esbuild';

type ResolveOptions  = Parameters<PluginBuild['onResolve']>[0];
type ResolveCallback = Parameters<PluginBuild['onResolve']>[1];
type EndCallback     = Parameters<PluginBuild['onEnd']>[0];
type ResolveResult   = Awaited<ReturnType<ResolveCallback>>;

/** One import an esbuild plugin is asked to resolve. Fields the plugins never read are defaulted. */
export interface StubResolveRequest {
  readonly kind:      ImportKind;
  readonly path:      string;
  readonly importer?: string;
}

/**
 * Stands in for esbuild's PluginBuild so a test can register a plugin and drive its callbacks
 * with the arguments esbuild would send, without running a build. It records the callbacks it is
 * given and does not judge them.
 */
export class StubPluginBuild {
  private readonly onResolveSpy = jest.fn<void, [ResolveOptions, ResolveCallback]>();
  private readonly onEndSpy     = jest.fn<void, [EndCallback]>();

  public registerPlugin(plugin: Plugin): void {
    plugin.setup(this.asPluginBuild());
  }

  public onResolve(options: ResolveOptions, callback: ResolveCallback): void {
    this.onResolveSpy(options, callback);
  }

  public onEnd(callback: EndCallback): void {
    this.onEndSpy(callback);
  }

  public async resolve(request: StubResolveRequest): Promise<ResolveResult> {
    const registration = this.onResolveSpy.mock.calls[0];
    if (!registration) {
      throw new Error('No onResolve callback was registered');
    }
    const args: OnResolveArgs = {
      path:       request.path,
      importer:   request.importer ?? '',
      namespace:  'file',
      resolveDir: '',
      kind:       request.kind,
      pluginData: undefined,
      with:       {},
    };
    return registration[1](args);
  }

  public async end(errors: Message[]): Promise<void> {
    const registration = this.onEndSpy.mock.calls[0];
    if (!registration) {
      throw new Error('No onEnd callback was registered');
    }
    const result: BuildResult = { errors, warnings: [], outputFiles: undefined, metafile: undefined, mangleCache: undefined };
    await registration[0](result);
  }

  private asPluginBuild(): PluginBuild {
    // cast: esbuild's PluginBuild has about 15 members and the plugins under test call only onResolve and onEnd, so the stub is typed to the full interface here and nowhere else.
    return this as unknown as PluginBuild;
  }
}
