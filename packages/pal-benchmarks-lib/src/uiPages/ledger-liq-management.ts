import {
  createButton,
  getEditableTextBoxStyle,
  ISettingsData,
  UiPage
} from '../common';
import { Box, BoxOptions, Button, Text, Textbox } from '@unblessed/node';
import { IPalClientLiquidityRequest } from 'pal-client-lib';

import { ILoadTestStats, LoadTests } from '../load';

export class LedgerLiquidityManagementPage extends UiPage {
  private _loadTests: LoadTests;
  private _liqManagementInputBox!: Textbox;
  private _textPending!: Text;
  private _textAseLiquidity!: Text;
  private _textAseClearing!: Text;
  private _textPeerLiquidity!: Text;
  private _textPeerClearing!: Text;
  private _depositAseBtn!: Button;
  private _depositPeerBtn!: Button;
  private _withdrawAseBtn!: Button;
  private _withdrawPeerBtn!: Button;

  private _log!: Box;

  constructor(data: ISettingsData, loadTests: LoadTests) {
    super(data);
    this._loadTests = loadTests;

    this._loadTests.on('statsAvailable', this._updateUi.bind(this));
  }

  protected async _onActivated(): Promise<void> {
    if (!this._loadTests.connected) {
      this._log.pushLine('Connecting to api and broker(s)...');
      await this._loadTests.init();
      this._log.pushLine('Connected to api and broker(s).');
    }

    if (this._loadTests.asset) {
      this._log.pushLine(`Asset: ${this._loadTests.asset.code} exists.`);
    }
    if (this._loadTests.peer) {
      this._log.pushLine(`Peer: ${this._loadTests.peer.name} exists.`);
    }
    if (this._loadTests.accounts.length > 0) {
      this._log.pushLine(
        `Accounts: ${this._loadTests.accounts.length} accounts found.`
      );
    }

    this._updateUi();
  }
  protected async _onDeactivated(): Promise<void> {}

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
      width: 24,
      left: 1,
      label: `Amount (${this._data.assetCode})`
    });
    this._liqManagementInputBox = new Textbox({
      parent: this._containerBox,
      name: 'amount',
      top: 1,
      left: 2,
      height: 1,
      width: 22,
      align: 'right',
      shadow: true,
      inputOnFocus: true,
      value: '0',
      style: getEditableTextBoxStyle()
    });

    this._depositAseBtn = this._createButton(
      'Deposit to ASE',
      'depositAse',
      'gray',
      'green',
      3
    );

    this._withdrawAseBtn = this._createButton(
      'Withdraw from ASE',
      'withdrawAse',
      'gray',
      'yellow',
      6
    );

    this._depositPeerBtn = this._createButton(
      'Deposit to Peer',
      'depositPeer',
      'gray',
      'green',
      9
    );

    this._withdrawPeerBtn = this._createButton(
      'Withdraw from Peer',
      'withdrawPeer',
      'gray',
      'yellow',
      12
    );

    this._textAseLiquidity = new Box({
      ...commonText,
      left: 26,
      label: 'ASE Liquidity',
      style: {
        fg: 'red'
      }
    });
    this._textPeerLiquidity = new Box({
      ...commonText,
      left: this._textAseLiquidity.left + 20,
      label: 'Peer Liquidity',
      style: {
        fg: 'green'
      }
    });
    this._textAseClearing = new Box({
      ...commonText,
      left: this._textPeerLiquidity.left + 20,
      label: 'ASE Clearing',
      style: {
        fg: 'red'
      }
    });
    this._textPeerClearing = new Box({
      ...commonText,
      left: this._textAseClearing.left + 20,
      label: 'Peer Clearing',
      style: {
        fg: 'green'
      }
    });

    this._log = new Box({
      parent: this._containerBox,
      top: 3,
      left: 26,
      height: '100%-5',
      width: '100%-29',
      scrollable: true,
      alwaysScroll: true,
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
    const getAmount = () => {
      const inputAmount = this._liqManagementInputBox.getContent();
      // this will throw if not a number
      const floatAmount = parseFloat(inputAmount);
      return floatAmount;
    };

    const createCommonLiqRequest = (): IPalClientLiquidityRequest => {
      if (!this._loadTests.asset) {
        throw new Error('Asset not loaded, is the loadTest client connected?');
      }

      const floatAmount = getAmount();
      const amount = floatAmount * 10 ** this._loadTests.asset.scale;

      return {
        requestId: crypto.randomUUID(),
        assetCode: this._data.assetCode,
        amountScale: this._loadTests.asset.scale,
        amount: amount.toString(),
        peerId: this._data.peerId
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this._depositAseBtn.on('press', async (data: string) => {
      const req = createCommonLiqRequest();
      this._log.pushLine(`Depositing ${getAmount()} To Ase...`);
      this._updateUi();

      await this._loadTests.apiClient.ledgerDepositToAse(req);

      // wait a second for read side
      setTimeout(async () => {
        this._log.pushLine(`Deposit To Ase completed successfully.`);
        await this._loadTests.updateAccountBalancesNow();
        this._updateUi();
      }, 1000);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this._withdrawAseBtn.on('press', async (data: string) => {
      const req = createCommonLiqRequest();
      this._log.pushLine(`Withdrawing ${getAmount()} From Ase...`);
      this._updateUi();

      await this._loadTests.apiClient.ledgerWithdrawFromAse(req);

      // wait a second for read side
      setTimeout(async () => {
        this._log.pushLine(`Withdraw from Ase completed successfully.`);
        await this._loadTests.updateAccountBalancesNow();
        this._updateUi();
      }, 1000);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this._depositPeerBtn.on('press', async (data: string) => {
      const req = createCommonLiqRequest();
      this._log.pushLine(`Depositing ${getAmount()} To Peer...`);
      this._updateUi();

      await this._loadTests.apiClient.ledgerDepositToPeer(req);

      // wait a second for read side
      setTimeout(async () => {
        this._log.pushLine(`Deposit to Peer completed successfully.`);
        await this._loadTests.updateAccountBalancesNow();
        this._updateUi();
      }, 1000);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this._withdrawPeerBtn.on('press', async (data: string) => {
      const req = createCommonLiqRequest();
      this._log.pushLine(`Withdrawing ${getAmount()} From Peer...`);
      this._updateUi();

      await this._loadTests.apiClient.ledgerWithdrawFromPeer(req);

      // wait a second for read side
      setTimeout(async () => {
        this._log.pushLine(`Withdraw from Peer completed successfully.`);
        await this._loadTests.updateAccountBalancesNow();
        this._updateUi();
      }, 1000);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _updateUi(stats?: ILoadTestStats) {
    this._textAseLiquidity.setContent(this._loadTests.balances.aseLiq ?? 'n/a');
    this._textAseLiquidity.style.fg =
      this._loadTests.balances.aseLiq?.startsWith('-') ? 'red' : 'green';

    this._textAseClearing.setContent(this._loadTests.balances.aseCle ?? 'n/a');
    this._textAseClearing.style.fg =
      this._loadTests.balances.aseCle?.startsWith('-') ? 'red' : 'green';

    this._textPeerLiquidity.setContent(
      this._loadTests.balances.peerLiq ?? 'n/a'
    );
    this._textPeerLiquidity.style.fg =
      this._loadTests.balances.peerLiq?.startsWith('-') ? 'red' : 'green';

    this._textPeerClearing.setContent(
      this._loadTests.balances.peerCle ?? 'n/a'
    );
    this._textPeerClearing.style.fg =
      this._loadTests.balances.peerCle?.startsWith('-') ? 'red' : 'green';

    this._containerBox.screen.render();
  }

  protected async _onReset(): Promise<void> {
    await this._loadTests.updateAccountBalancesNow();

    this._log.setContent('');
    this._log.pushLine('Reset called.');

    this._updateUi();
  }

  private _createButton(
    label: string,
    fieldName: string,
    fg: string,
    bg: string,
    top: number
  ): Button {
    const btn = createButton(this._containerBox, label, fieldName, fg, bg);
    btn.left = 1;
    btn.width = 24;
    btn.top = top;
    btn.shrink = false;
    return btn;
  }

  private async onLiqMangementButtonPressed(): Promise<void> {}
}
