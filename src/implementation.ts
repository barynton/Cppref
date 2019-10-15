import * as vscode from 'vscode';
import * as cpprefInfo from './info';
import * as cpprefHelpers from './helpers';
import * as cpprefNamespace from './namespace';

const headerSourceSwitchTimeout = 500;

function getVirtualMethods(classInfo: cpprefInfo.ClassInfo, rootNamespace: string): Array<cpprefInfo.FunctionInfo> {
	let result = new Array<cpprefInfo.FunctionInfo>();
	let overriden = new Array<cpprefInfo.FunctionInfo>();

	let infos = classInfo.methodInfos.filter(info => info.methodDescription !== undefined 
		&& info.methodDescription.get(cpprefInfo.MethodDescriptor.virtual));
	
	let namespace = classInfo.getFullName();

	if (rootNamespace !== namespace) {
		infos.forEach(info => {
			if (info.text !== undefined && info.name !==undefined ) {
				info.text = info.text.replace(namespace+"::"+info.name, rootNamespace+"::"+info.name);
				result.push(info);
			}
		});
	}
	else {
		classInfo.methodInfos.forEach(info => { 
			if (info.methodDescription !== undefined) {
				if (info.methodDescription.get(cpprefInfo.MethodDescriptor.override)) {
					overriden.push(info);
				}
			}
		});

		infos.forEach(info => { 
			if (info.methodDescription !== undefined) {
				if (!info.methodDescription.get(cpprefInfo.MethodDescriptor.override)) {
					result.push(info);
				}
			}
		});
	}

	if (classInfo.parentIfos !== undefined) {
		classInfo.parentIfos.forEach(parentInfo => getVirtualMethods(parentInfo, rootNamespace).forEach(m =>{ 
			const regexp = new RegExp(/\s*/g);
			if (	!result.find(e => e.name === m.name && e.text.replace(regexp, "") === m.text.replace(regexp, "") )
				&& 	!overriden.find(e => e.name === m.name && e.text.replace(regexp, "") === m.text.replace(regexp, ""))) {
				result.push(m);
			}
		}));
	}

	return result;
}

async function writeOverrideDeclaration(editor: vscode.TextEditor, insertLocaiton: vscode.Location, methodInfos: Array<cpprefInfo.FunctionInfo>) {
	let text : string = "";
	
	methodInfos.forEach(info => {
		const prefix = "    ";

		if (info.text !== undefined) {
			text += info.text + " override;\n";
		}
	});
	
	await editor.edit(edit =>{
		edit.insert(insertLocaiton.range.end, "\n" + text);
	});
}

function searchInsertPosition(document: vscode.TextDocument, namespace: string): Thenable<vscode.Position> {
	return new Promise<vscode.Position>(async (resolve, _) => {
		let result = undefined;

		if (!namespace.length) {
			resolve(document.lineAt(document.lineCount-1).rangeIncludingLineBreak.end);
			return;
		}

		let symbolInfos = await cpprefInfo.getSymbolInformation(document.uri);

		if (!symbolInfos) {
			resolve(result);
			return;
		}

		let namespaceInfos = cpprefInfo.searchNamespace(namespace, symbolInfos, document);

		if (!namespaceInfos) {
			resolve(result);
			return;
		}

		let location =  cpprefHelpers.getLocationBehind(document, namespaceInfos[0].location.range.end, "{");

		if (location) {
			result = location.range.end;
		}

		resolve(result);
	});
}

function getMethodsText(methodInfos: Array<cpprefInfo.FunctionInfo>, classInfo: cpprefInfo.ClassInfo, definitionWithNamespace: boolean): string {
	let result = "";
	
	methodInfos.forEach(info => {
		if (info.text !== undefined && info.name !== undefined) {
			let methodText = info.text;

			if (definitionWithNamespace) {
				methodText = methodText.replace(info.name, classInfo.getFullName() + "::" + info.name);
			} else {
				methodText = methodText.replace(info.name, classInfo.name + "::" + info.name);
			}

			methodText = cpprefHelpers.removeIndent(methodText);

			result += "\n" + methodText + " {\n}\n";
		}
	});

	return result;
}

function getInsertPosition(editor: vscode.TextEditor, namespace: string, definitionWithNamespace: boolean): Thenable<vscode.Position> {
	return new Promise<vscode.Position>(async (resolve, _) => {
		let insertPosition;

		let document = editor.document;

		if (definitionWithNamespace) {
			insertPosition = await searchInsertPosition(document, "");
		} else {
			insertPosition = await searchInsertPosition(document, namespace);

			if (!insertPosition) {
				let documentEnd = cpprefHelpers.getDocumentRange(document).end;

				await editor.edit(edit => {
					let position = cpprefNamespace.insertNamespace(namespace.split("::"), edit, documentEnd);

					if (position) {
						insertPosition = position;
					}
					else {
						insertPosition = documentEnd;
					}
				});
			}
		}

		resolve(insertPosition);
	});
}

async function writeVirtualMethodsImplementaion(classInfo: cpprefInfo.ClassInfo, uri:vscode.Uri) {
	let methodInfos = getVirtualMethods(classInfo, classInfo.getFullName());

	let editor = vscode.window.activeTextEditor;

	if (editor === undefined || classInfo.declarationStart === undefined || methodInfos === undefined) {
		return;
	}

	await writeOverrideDeclaration(editor, classInfo.declarationStart, methodInfos);

	vscode.commands.executeCommand<any>('C_Cpp.SwitchHeaderSource', uri).then (async _ => {
		setTimeout(async _ => { // we need timeout to wait for switch, otherwise the document is not editable
			let currentEditor = vscode.window.activeTextEditor;
					
			if (currentEditor)
			{
				if (!classInfo.methodInfos) {
					return;
				}

				let definitionWithNamespace = vscode.workspace.getConfiguration("cppref").get<boolean>("definition_with_namespace");

				if (definitionWithNamespace === undefined) {
					return;
				}

				let insertPosition = await getInsertPosition(currentEditor, classInfo.namespace, definitionWithNamespace);

				let text = getMethodsText(methodInfos, classInfo, definitionWithNamespace);

				currentEditor.edit(edit => {
					edit.insert(insertPosition, text);
					vscode.window.showInformationMessage("Implemented " + methodInfos.length.toString() + " methods", "");
				});
			}
		}, headerSourceSwitchTimeout);
	});
}

export function implementVirtualFunctions() {
	let activeEditor = vscode.window.activeTextEditor;
		
	if (activeEditor !== undefined) {
		cpprefInfo.getFirstDeclarationLocation(new vscode.Location(activeEditor.document.uri, activeEditor.selection.active)).then( location => {
			if (location === undefined) {
				return;
			}

			cpprefInfo.getClassInfo(location).then(classInfo => {
				writeVirtualMethodsImplementaion(classInfo, location.uri);			
			});
		});
	}
}