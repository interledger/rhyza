import { Screen, Box, Button, Node } from '@unblessed/node';

export const DEFAULT_ASSET_SCALE = 2;

export interface IUiPage {
  active: boolean;
  deactivate(screen: Screen): Promise<void>;
  activate(screen: Screen): Promise<void>;
  reset(): Promise<void>;
}

export function getEditableTextBoxStyle() {
  return {
    fg: 'black',
    bg: '#888',
    focus: {
      bg: 'white',
      fg: 'black'
    }
  };
}

export function createButton(
  parent: Node | undefined,
  label: string,
  fieldName: string,
  fg: string,
  bg: string
): Button {
  return new Button({
    parent: parent,
    name: fieldName,
    content: `{center}${label}{/center}`,
    shrink: true,
    mouse: true,
    tags: true,
    keys: true,
    bottom: 0,
    height: 3,
    padding: {
      right: 2,
      left: 2
    },
    style: {
      fg: fg,
      bg: bg,
      focus: {
        bg: 'white',
        fg: 'black'
      }
    },
    border: { type: 'line' }
  });
}

export interface ISettingsData {
  testIdPrefix: string;
  kafkaUrl: string;
  assetCode: string;
  peerId: string;
  disableConsoleLog: boolean;
}

export abstract class UiPage implements IUiPage {
  protected _data: ISettingsData;
  protected _containerBox: Box;
  protected _active: boolean;

  // protected _onActivated: (() => void) | null;
  // protected _onDeactivated: (() => void) | null;
  get active(): boolean {
    return this._active;
  }

  protected abstract _onActivated(): Promise<void>;
  protected abstract _onDeactivated(): Promise<void>;
  protected abstract _onReset(): Promise<void>;

  protected abstract _createUiElements(): void;
  protected abstract _hookUiHandlers(): void;

  protected constructor(data: ISettingsData) {
    this._data = data;
    this._active = false;

    this._containerBox = new Box({
      top: 6,
      left: 0,
      focusable: false,
      width: '100%',
      height: '100%-9',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'green'
        }
      }
    });
  }

  public static create<T extends UiPage, C extends new (...args: never[]) => T>(
    this: C,
    ...args: ConstructorParameters<C>
  ): T {
    const instance = new this(...args);
    instance._createUiElements();
    instance._hookUiHandlers();
    return instance;
  }

  async activate(screen: Screen): Promise<void> {
    screen.append(this._containerBox);
    screen.render();

    await this._onActivated();
    this._active = true;
  }

  async deactivate(screen: Screen): Promise<void> {
    screen.remove(this._containerBox);
    this._containerBox.detach();

    await this._onDeactivated();

    screen.render();
    this._active = false;
  }

  async reset(): Promise<void> {
    await this._onReset();
  }
}
