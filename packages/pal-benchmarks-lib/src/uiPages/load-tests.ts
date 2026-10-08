import { Box, BoxOptions, Text, Textbox } from '@unblessed/node';

import { getEditableTextBoxStyle, ISettingsData, UiPage } from '../common';
import { ILoadTestStats, LoadTests } from '../load';

export class LoadTestsPage extends UiPage {
  private _loadTests: LoadTests;
  private reqsPerSecInputBox!: Textbox;
  private _textAvgRespTime!: Text;
  private _textPending!: Text;
  private _textAseClearing!: Text;
  private _textPeerClearing!: Text;
  private _textErrorCount!: Text;

  private _log!: Box;

  constructor(data: ISettingsData, loadTests: LoadTests) {
    super(data);
    this._loadTests = loadTests;

    this._loadTests.on('logAvailable', (logLine: string) => {
      if (!this._active) return;
      this._log.pushLine(`${logLine}`);
      this._log.setScrollPerc!(100);
      this._log.screen.render();
    });

    this._loadTests.on('statsAvailable', this._updateUi.bind(this));
  }

  protected async _onActivated(): Promise<void> {
    if (!this._loadTests.connected) {
      this._log.pushLine('Connecting to api and broker(s)...');
      await this._loadTests.init();
      this._log.pushLine('Connected to api and broker(s).');
    }
    this._updateUi();

    this.reqsPerSecInputBox.value = this._loadTests.perSecCount.toString();
  }
  protected async _onDeactivated(): Promise<void> {}

  private _updateUi(stats?: ILoadTestStats) {
    if (stats) {
      this._textAvgRespTime.setContent(
        Math.round(stats.avgTimePerMessageMs).toString() + ' ms'
      );
      this._textPending.setContent(
        Math.round(stats.totalMessagesPending).toString()
      );
    }

    this._textAseClearing.setContent(this._loadTests.balances.aseCle || 'n/a');
    this._textAseClearing.style.fg =
      this._loadTests.balances.aseCle?.startsWith('-') ? 'red' : 'green';
    this._textPeerClearing.setContent(
      this._loadTests.balances.peerCle || 'n/a'
    );
    this._textPeerClearing.style.fg =
      this._loadTests.balances.peerCle?.startsWith('-') ? 'red' : 'green';
    this._textErrorCount.setContent(
      this._loadTests.errorResponseCount.toString()
    );
  }

  protected _createUiElements() {
    const commonText: BoxOptions = {
      top: 0,
      height: 3,
      width: 20,
      tags: true,
      parent: this._containerBox,
      border: { type: 'line' },
      style: {
        fg: 'green',
        bg: 'black'
      },
      focusable: false
    };

    // this._text1 = new Box({
    new Box({
      ...commonText,
      left: 1,
      label: 'Req/sec'
    });
    this.reqsPerSecInputBox = new Textbox({
      parent: this._containerBox,
      name: 'reqspersec',
      top: 1,
      left: 2,
      height: 1,
      width: 18,
      align: 'right',
      shadow: true,
      inputOnFocus: true,
      value: '0',
      style: getEditableTextBoxStyle()
    });

    this._textAvgRespTime = new Box({
      ...commonText,
      left: 21,
      label: 'Avg resp time'
    });

    this._textPending = new Box({
      ...commonText,
      left: 41,
      label: 'Pending',
      style: {
        fg: 'red'
      }
    });
    this._textErrorCount = new Box({
      ...commonText,
      left: 61,
      label: 'ErrorCount',
      style: {
        fg: 'red'
      }
    });

    this._textAseClearing = new Box({
      ...commonText,
      left: 81,
      label: 'ASE Clearing',
      style: {
        fg: 'red'
      }
    });
    this._textPeerClearing = new Box({
      ...commonText,
      left: 101,
      label: 'Peer Clearing',
      style: {
        fg: 'green'
      }
    });

    this._log = new Box({
      parent: this._containerBox,
      top: 3,
      left: 1,
      height: '100%-5',
      width: '100%-4',
      scrollable: true,

      alwaysScroll: true,
      input: true,
      //scrollback: 1000,
      mouse: true,
      keys: true,
      focusable: true,
      vi: true,
      border: {
        type: 'line'
      },
      scrollbar: {
        ch: '█',
        style: { bg: 'cyan' },
        track: {
          bg: 'yellow'
        }
      }
    });
  }

  protected _hookUiHandlers() {
    this.reqsPerSecInputBox.on('submit', (data: string) => {
      this._log.pushLine(`Updated request per second to: ${data}`);
      this._loadTests.perSecCount = parseInt(data);
    });
  }

  protected async _onReset(): Promise<void> {
    this._log.setContent('');
    this._log.pushLine('Reset called.');
  }
}
