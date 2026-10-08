import { Form, Text, Textbox, Button } from '@unblessed/node';
import {
  createButton,
  getEditableTextBoxStyle,
  ISettingsData,
  UiPage
} from '../common';

export class SettingsPage extends UiPage {
  private _form!: Form;
  private _textBoxTestPrefix!: Textbox;
  private _textBoxAssetCode!: Textbox;
  private _textBoxKafkaUrl!: Textbox;
  private _textBoxPeerId!: Textbox;
  private _submitBtn!: Button;
  private _cancelBtn!: Button;

  constructor(data: ISettingsData) {
    super(data);
  }

  protected async _onActivated(): Promise<void> {
    this._textBoxTestPrefix.focus();
  }
  protected async _onDeactivated(): Promise<void> {}

  protected _createUiElements() {
    this._form = new Form({
      parent: this._containerBox,
      top: 0,
      left: 2,
      width: '100%-6',
      keys: true,
      vi: true
    });

    this._textBoxTestPrefix = this._createFormTextItem(
      'Test Prefix',
      'testPrefix',
      0,
      this._data.testIdPrefix || ''
    );

    this._textBoxAssetCode = this._createFormTextItem(
      'Asset Code',
      'assetCode',
      1,
      this._data.assetCode || ''
    );

    this._textBoxKafkaUrl = this._createFormTextItem(
      'Kafka URL',
      'kafkaUrl',
      2,
      this._data.kafkaUrl || ''
    );

    this._textBoxPeerId = this._createFormTextItem(
      'Peer ID',
      'peerId',
      3,
      this._data.peerId || ''
    );

    // Submit/Cancel buttons
    this._submitBtn = this._createButton('Save', 'submit', 'gray', 'green');
    this._submitBtn.right = 12;

    this._cancelBtn = this._createButton('Reset', 'cancel', 'white', 'red');
    this._cancelBtn.right = 0;
  }

  protected _hookUiHandlers() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._submitBtn.on('press', (data: any) => {
      this._formSubmit(data);
    });
    this._cancelBtn.on('press', () => {
      this._formReset();
    });

    this._form.on('submit', (data: never) => {
      this._formSubmit(data);
    });
  }

  private _formReset() {
    this._textBoxTestPrefix.setValue(this._data.testIdPrefix);
    this._textBoxAssetCode.setValue(this._data.assetCode);
    this._textBoxKafkaUrl.setValue(this._data.kafkaUrl);
    this._textBoxPeerId.setValue(this._data.peerId);
    this._containerBox.render();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars,@typescript-eslint/no-explicit-any
  private _formSubmit(data: any) {
    console.log('form submit');
    this._data.testIdPrefix = this._textBoxTestPrefix.getValue();
    this._data.assetCode = this._textBoxAssetCode.getValue();
    this._data.kafkaUrl = this._textBoxKafkaUrl.getValue();
    this._data.peerId = this._textBoxPeerId.getValue();
    this._containerBox.render();
  }

  private _createButton(
    label: string,
    fieldName: string,
    fg: string,
    bg: string
  ): Button {
    return createButton(this._containerBox, label, fieldName, fg, bg);
  }

  private _createFormTextItem(
    label: string,
    fieldName: string,
    order: number,
    value: string,
    labelWidth: number = 15
  ): Textbox {
    // we need it to start from 0
    new Text({
      parent: this._containerBox,
      top: order * 4 + 1,
      left: 0,
      content: label
    });
    const textBox = new Textbox({
      parent: this._containerBox,
      name: fieldName,
      top: order * 4,
      left: labelWidth,
      height: 3,
      shadow: true,
      inputOnFocus: true,
      value: value || '',
      border: { type: 'line' },
      style: getEditableTextBoxStyle()
    });
    return textBox;
  }

  protected async _onReset(): Promise<void> {}
}
