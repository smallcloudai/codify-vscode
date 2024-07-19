/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as estate from "./estate";
import * as userLogin from "./userLogin";
import * as chatTab from './chatTab';
import * as statisticTab from './statisticTab';
import * as fimDebug from './fimDebug';
import { get_caps } from "./fetchAPI";
import ChatHistoryProvider from "./chatHistory";
import { Chat } from "./chatHistory";
import * as crlf from "./crlf";
import { v4 as uuidv4 } from "uuid";
import {
	EVENT_NAMES_FROM_CHAT,
	EVENT_NAMES_FROM_SETUP,
	EVENT_NAMES_FROM_STATISTIC,
	FIM_EVENT_NAMES,
} from "refact-chat-js/dist/events";
import { getKeyBindingForChat } from "./getKeybindings";
import { ChatMessages } from "refact-chat-js/dist/events";

type Handler = ((data: any) => void) | undefined;
function composeHandlers(...eventHandlers: Handler[]) {
    return (data: any) => eventHandlers.forEach(fn => fn && fn(data));
}

export async function open_chat_tab(
    question: string,
    editor: vscode.TextEditor | undefined,
    attach_default: boolean,   // checkbox set on start, means attach the current file
    model: string,
    messages: ChatMessages,
    chat_id: string,
    append_snippet_to_input: boolean = false,
): Promise<chatTab.ChatTab|undefined> {
    if (global.side_panel?.chat) {
        global.side_panel.chat = null;
    }

    console.log({side_panel: !!global.side_panel})
    console.log({view: !!global.side_panel?._view});


     // FIX: view can be false when open a new chat.
        if (global.side_panel && global.side_panel._view) {
            // TODO: check this
            let chat: chatTab.ChatTab = global.side_panel.new_chat(global.side_panel._view, chat_id);

            let context: vscode.ExtensionContext | undefined = global.global_context;
            if (!context) {
                return;
            }
            global.side_panel.goto_chat(chat);  // changes html
            await chatTab.ChatTab.clear_and_repopulate_chat(
                question,
                editor,
                attach_default,
                model,
                messages,
                append_snippet_to_input,
            );
            return chat;
        }

    return;
}

export async function open_statistic_tab(): Promise<statisticTab.StatisticTab|undefined> {
    if (global.side_panel && global.side_panel._view) {
        let stat = global.side_panel.new_statistic(global.side_panel._view);

        let context: vscode.ExtensionContext | undefined = global.global_context;
        if (!context) {
            return;
        }
        global.side_panel.goto_statistic(stat);  // changes html
    }
    return;
}

export async function open_fim_debug(): Promise<void> {
    if (global.side_panel && global.side_panel._view) {
        let fim = global.side_panel.new_fim_debug(global.side_panel._view);

        let context: vscode.ExtensionContext | undefined = global.global_context;
        if (!context) {
            return;
        }

        global.side_panel.goto_fim(fim);
    }
    return;
}

export class PanelWebview implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    _history: string[] = [];
    selected_lines_count: number = 0;
    access_level: number = -1;
    cancel_token: vscode.CancellationToken | undefined = undefined;
    public address: string;

    public chat: chatTab.ChatTab | null = null;
    public statistic: statisticTab.StatisticTab | null = null;
    public fim_debug: fimDebug.FimDebug | null = null;
    public chatHistoryProvider: ChatHistoryProvider|undefined;

    public static readonly viewType = "refactai-toolbox";

    constructor(private readonly _context: any) {
        this.chatHistoryProvider = undefined;
        this.address = "";
        this.js2ts_message = this.js2ts_message.bind(this);
    }

    handleEvents(data: any) {
        if(!this._view) { return; }
        return composeHandlers(this.chat?.handleEvents, this.js2ts_message)(data);
    }

    public make_sure_have_chat_history_provider()
    {
        if (!this.chatHistoryProvider) {
            this.chatHistoryProvider = new ChatHistoryProvider(
                this._context,
            );
        }
        return this.chatHistoryProvider;
    }

    public new_chat(view: vscode.WebviewView, chat_id: string)
    {
        if (chat_id === "" || chat_id === undefined) {
            chat_id = uuidv4();
        }
        this.chat = new chatTab.ChatTab(view, this.make_sure_have_chat_history_provider(), chat_id);
        this.address = chat_id;
        return this.chat;
    }

    public new_statistic(view: vscode.WebviewView)
    {
        this.statistic = new statisticTab.StatisticTab(view);
        return this.statistic;
    }

    public new_fim_debug(view: vscode.WebviewView) {
        this.fim_debug = new fimDebug.FimDebug(view);
        return this.fim_debug;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        cancel_token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        this.cancel_token = cancel_token;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.update_webview();
            }
        });

        this.goto_main();

        vscode.commands.registerCommand('workbench.action.focusSideBar', () => {
            webviewView.webview.postMessage({ command: "focus" });
        });

        webviewView.webview.onDidReceiveMessage(async (data) => {
            this.handleEvents(data);
        });
    }

    public async goto_main()
    {
        this.address = "";
        if (!this._view) {
            return;
        }
        this._view.webview.html = await this.html_main_screen(this._view.webview);
        this.update_webview();
    }

    public goto_chat(chat: chatTab.ChatTab)
    {
        this.address = chat.chat_id;
        if (!this._view) {
            return;
        }
        this._view.webview.html = chat.get_html_for_chat(
            this._view.webview,
            this._context.extensionUri
        );
        this.update_webview();
    }

    public goto_statistic(statistic: statisticTab.StatisticTab)
    {
        if (!this._view) {
            return;
        }
        this._view.webview.html = statistic.get_html_for_statistic(
            this._view.webview,
            this._context.extensionUri,
        );
        this.update_webview();
    }

    public goto_fim(fim: fimDebug.FimDebug) {
        if (!this._view) { return; }
        this._view.webview.html = fim.get_html(
            this._view.webview,
            this._context.extensionUri
        );
        this.update_webview();
    }

    public update_chat_history()
    {
        const history = this.make_sure_have_chat_history_provider().chats_sorted_by_time();
        if (this._view) {
            this._view.webview.postMessage({
                command: "loadHistory",
                history: history,
            });
        }
    }

    public async delete_old_settings()
    {
        await vscode.workspace.getConfiguration().update('refactai.apiKey', undefined, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration().update('refactai.addressURL', undefined, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration().update('codify.apiKey', undefined, vscode.ConfigurationTarget.Global);
        if(vscode.workspace.workspaceFolders) {
            await vscode.workspace.getConfiguration().update('refactai.apiKey', undefined, vscode.ConfigurationTarget.Workspace);
            await vscode.workspace.getConfiguration().update('refactai.addressURL', undefined, vscode.ConfigurationTarget.Workspace);
            await vscode.workspace.getConfiguration().update('codify.apiKey', undefined, vscode.ConfigurationTarget.Workspace);
        }
    }

    public async js2ts_message(data: any)
    {
        if (!this._view) {
            return;
        }
        // console.log(`RECEIVED JS2TS: ${JSON.stringify(data)}`);
        switch (data.type) {
        case EVENT_NAMES_FROM_CHAT.OPEN_IN_CHAT_IN_TAB:
        case "open_chat_in_new_tab": {
            const chat_id = data?.chat_id || this.chat?.chat_id;
            // const chat_id = data.payload.id;
            if(!chat_id || typeof chat_id !== "string") {return; }
            if(!this.chatHistoryProvider) { return; }

            const openTab = global.open_chat_tabs?.find(tab => tab.chat_id === chat_id);
            if(openTab) {
                return openTab.focus();
            }
            // is extensionUri defined anywhere?
            await chatTab.ChatTab.open_chat_in_new_tab(this.chatHistoryProvider, chat_id, this._context.extensionUri, true);
            this.chat = null;
            return this.goto_main();
        }
        case "focus_back_to_editor": {
            vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
            break;
        }

        case "open_new_chat": {
            let question = data.question;
            if (!question) {
                question = "";
            }
            let editor = vscode.window.activeTextEditor;
            let attach_default = !!vscode.window.activeTextEditor;
            await open_chat_tab(
                question,
                editor,
                attach_default,
                data.chat_model,
                [],      // messages
                "",      // chat id
                true,
            );
            break;
        }
        case "open_statistic": {
            await open_statistic_tab();
            break;
        }
        case "delete_chat": {
            const chat_id = data.chat_id;
            await this.make_sure_have_chat_history_provider().delete_chat(chat_id);
            break;
        }
        case "button_hf_open_tokens": {
            vscode.env.openExternal(vscode.Uri.parse(`https://huggingface.co/settings/tokens`));
            break;
        }
        case "button_hf_save": {
            await this.delete_old_settings();
            await vscode.workspace.getConfiguration().update('refactai.addressURL', "HF", vscode.ConfigurationTarget.Global);
            await vscode.workspace.getConfiguration().update('refactai.apiKey', data.hf_api_key, vscode.ConfigurationTarget.Global);
            break;
        }
        case "button_refact_save": {
            await this.delete_old_settings();
            await vscode.workspace.getConfiguration().update('refactai.addressURL', "Refact", vscode.ConfigurationTarget.Global);
            await vscode.workspace.getConfiguration().update('refactai.apiKey', data.refact_api_key, vscode.ConfigurationTarget.Global);
            break;
        }
        case "button_refact_open_streamlined": {
            await this.delete_old_settings();
            await vscode.workspace.getConfiguration().update('refactai.addressURL', "Refact", vscode.ConfigurationTarget.Global);
            vscode.commands.executeCommand('refactaicmd.login');
            break;
        }
        case "save_enterprise": {
            await this.delete_old_settings();
            await vscode.workspace.getConfiguration().update('refactai.addressURL', data.endpoint, vscode.ConfigurationTarget.Global);
            await vscode.workspace.getConfiguration().update('refactai.apiKey', data.apikey, vscode.ConfigurationTarget.Global);
            break;
        }
        case "save_selfhosted": {
            await this.delete_old_settings();
            await vscode.workspace.getConfiguration().update('refactai.addressURL', data.endpoint, vscode.ConfigurationTarget.Global);
            await vscode.workspace.getConfiguration().update('refactai.apiKey', 'any-will-work-for-local-server', vscode.ConfigurationTarget.Global);
            break;
        }
        case "privacy": {
            vscode.commands.executeCommand("refactaicmd.privacySettings");
            break;
        }
        case "js2ts_report_bug": {
            vscode.env.openExternal(vscode.Uri.parse(`https://github.com/smallcloudai/refact-vscode/issues`));
            break;
        }
        case "js2ts_discord": {
            vscode.env.openExternal(vscode.Uri.parse(`https://www.smallcloud.ai/discord`));
            break;
        }
        case "js2ts_logout": {
            vscode.commands.executeCommand("refactaicmd.logout");
            break;
        }
        case "js2ts_goto_profile": {
            vscode.env.openExternal(vscode.Uri.parse(`https://refact.smallcloud.ai/account?utm_source=plugin&utm_medium=vscode&utm_campaign=account`));
            break;
        }
        case "js2ts_refresh_login": {
            userLogin.inference_login_force_retry();
            await userLogin.inference_login();
            break;
        }
        case "openSettings": {
            vscode.commands.executeCommand("refactaicmd.openSettings");
            break;
        }
        case "openKeys": {
            vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", "Refact.ai");
            break;
        }
        case "restore_chat": {
            const chat_id = data.chat_id;
            if (!chat_id) {
                break;
            }
            let editor = vscode.window.activeTextEditor;

            const caps = await get_caps();

            let chat: Chat | undefined = await this.make_sure_have_chat_history_provider().lookup_chat(chat_id);
            if (!chat) {
                console.log(`Chat ${chat_id} not found, cannot restore`);
                break;
            }

            const openTab = global.open_chat_tabs?.find(tab => tab.chat_id === chat_id);
            if(openTab) {
                return openTab.focus();
            } else {
                const model = caps.running_models.includes(chat.chatModel)
					? chat.chatModel
					: caps.code_chat_default_model;

                await open_chat_tab(
                    "",
                    editor,
                    true,
                    model,
                    chat.messages,
                    chat_id,
                );
            }
            break;
        }
        case "save_telemetry_settings": {
            // await vscode.workspace.getConfiguration().update('refactai.telemetryCodeSnippets', data.code, vscode.ConfigurationTarget.Global);
            break;
        }
        case "setup_host": {
            const { host } = data.payload;
            if (host.type === "cloud") {
                await this.delete_old_settings();
                await vscode.workspace.getConfiguration().update('refactai.telemetryCodeSnippets', host.sendCorrectedCodeSnippets, vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('refactai.addressURL', "Refact", vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('refactai.apiKey', host.apiKey, vscode.ConfigurationTarget.Global);
            } else if (host.type === "self") {
                await this.delete_old_settings();
                await vscode.workspace.getConfiguration().update('refactai.addressURL', host.endpointAddress, vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('refactai.apiKey', 'any-will-work-for-local-server', vscode.ConfigurationTarget.Global);
            } else if (host.type === "enterprise") {
                await this.delete_old_settings();
                await vscode.workspace.getConfiguration().update('refactai.addressURL', host.endpointAddress, vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('refactai.apiKey', host.apiKey, vscode.ConfigurationTarget.Global);
            }
            break;
        }
        case "open_external_url": {
            await vscode.env.openExternal(vscode.Uri.parse(data.payload.url));
            break;
        }
        case EVENT_NAMES_FROM_CHAT.BACK_FROM_CHAT:
        case EVENT_NAMES_FROM_STATISTIC.BACK_FROM_STATISTIC:
        case FIM_EVENT_NAMES.BACK:
        case "back-from-chat": {
            this.goto_main();
            this.chat = null;
            break;
        }

        case "fim_debug": {
            await open_fim_debug();
            break;
        }
        }
    }

    public update_webview()
    {
        if (!this._view) {
            return;
        }
        let have_key = !!userLogin.secret_api_key() && !!userLogin.get_address();
        if (have_key) {
            this.update_chat_history();
        }
        let plan_msg = global.user_active_plan;
        if (!plan_msg && global.streamlined_login_countdown > -1) {
            plan_msg = `Waiting for website login... ${global.streamlined_login_countdown}`;
        } else if (plan_msg) {
            plan_msg = "Active Plan: <b>" + plan_msg + "</b>";
        }
        this._view!.webview.postMessage({
            command: "ts2js",
            ts2js_user: global.user_logged_in,
            ts2js_havekey: have_key,
            ts2js_apikey: global.api_key,
            ts2js_plan: plan_msg,
            ts2js_metering_balance: global.user_metering_balance,
            ts2js_staging: vscode.workspace.getConfiguration().get('refactai.staging'),
            ts2js_stat_info: "stat inforamtion"
        });
    }

    private async html_main_screen(webview: vscode.Webview)
    {
        const extensionUri = this._context.extensionUri;
        const vecdb = vscode.workspace
			.getConfiguration()
			?.get<boolean>("refactai.vecdb") ?? false;

        const ast = vscode.workspace.getConfiguration()?.get<boolean>("refactai.ast") ?? false;

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, "node_modules", "refact-chat-js", "dist", "chat", "index.umd.cjs")
        );

        const styleMainUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, "node_modules", "refact-chat-js", "dist", "chat", "style.css")
        );

        const styleOverride = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, "assets", "custom-theme.css")
        );

        const fontSize = vscode.workspace.getConfiguration().get<number>("editor.fontSize") ?? 12;
        const scaling = fontSize < 14 ? "90%" : "100%";

        const apiKey = vscode.workspace.getConfiguration()?.get<string>("refactai.apiKey") ?? "";
        const addressURL = vscode.workspace.getConfiguration()?.get<string>("refactai.addressURL") ?? "";

        const nonce = this.getNonce();
        const api_key = vscode.workspace.getConfiguration().get('refactai.apiKey');
        let telemetry_code = '';
        // if(vscode.workspace.getConfiguration().get('refactai.telemetryCodeSnippets')) {
        //     telemetry_code = 'checked';
        // }
        let existing_address = vscode.workspace.getConfiguration().get("refactai.addressURL");
        if (typeof existing_address !== "string" || (typeof existing_address === "string" && !existing_address.match(/^https?:\/\//))) {
            existing_address = "";
        }

        const open_chat_hotkey = await getKeyBindingForChat();

        return `<!DOCTYPE html>
            <html lang="en" class="light">
            <head>
                <meta charset="UTF-8">
                <!--
                    Use a content security policy to only allow loading images from https or from our extension directory,
                    and only allow scripts that have a specific nonce.
                    TODO: remove  unsafe-inline if posable
                -->
                <meta http-equiv="Content-Security-Policy" content="style-src ${
                  webview.cspSource
                } 'unsafe-inline'; img-src 'self' data: https:; script-src 'nonce-${nonce}'; style-src-attr 'sha256-tQhKwS01F0Bsw/EwspVgMAqfidY8gpn/+DKLIxQ65hg=' 'unsafe-hashes';">
                <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1">

                <title>Refact.ai Chat</title>
                <link href="${styleMainUri}" rel="stylesheet">
                <link href="${styleOverride}" rel="stylesheet">
            </head>
            <body>
                <div id="refact-chat"></div>

                <script nonce="${nonce}" src="${scriptUri}"></script>

                <script nonce="${nonce}">
                window.onload = function() {
                    const root = document.getElementById("refact-chat")
                    RefactChat.renderApp(root, {
                        host: "vscode",
                        tabbed: true,
                        themeProps: {
                            accentColor: "gray",
                            scaling: "${scaling}",
                        },
                        features: {
                            vecdb: ${vecdb},
                            ast: ${ast},
                        },
                        apiKey: "${apiKey}",
                        addressURL: "${addressURL}"
                    })
                }
                </script>
            </body>
            </html>`;
    }

    getNonce() {
        let text = "";
        const possible =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}


export default PanelWebview;