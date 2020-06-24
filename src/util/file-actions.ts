import { useCallback, useEffect, useMemo } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { Nullable } from 'tsdef';

import {
    dispatchFileActionState,
    fileActionDataState,
    fileActionMapState,
    fileActionSelectedFilesCountState,
    fileActionsState,
    requestFileActionState,
} from '../recoil/file-actions.recoil';
import { parentFolderState } from '../recoil/files.recoil';
import { searchBarVisibleState } from '../recoil/search.recoil';
import { FileAction, FileActionHandler } from '../types/file-actions.types';
import {
    useInternalFileActionDispatcher,
    useInternalFileActionRequester,
} from './file-action-handlers';
import { ChonkyActions } from './file-actions-definitions';
import { FileHelper } from './file-helper';
import { useRefCallbackWithErrorHandling } from './hooks-helpers';

export const useFileActions = (
    fileActions: FileAction[],
    externalFileActonHandler: Nullable<FileActionHandler>
) => {
    // Recoil state: Put file actions and file action map into state
    const setFileActions = useSetRecoilState(fileActionsState);
    const setFileActionMap = useSetRecoilState(fileActionMapState);
    useEffect(() => {
        const fileActionMap = {};
        for (const action of fileActions) fileActionMap[action.id] = action;

        setFileActions(fileActions);
        setFileActionMap(fileActionMap);
    }, [fileActions, setFileActions, setFileActionMap]);

    // Prepare file action dispatcher (used to dispatch actions to users)
    const internalFileActionDispatcher = useInternalFileActionDispatcher(
        externalFileActonHandler
    );
    // Recoil state: Put file action dispatcher into Recoil state, in a way that will
    // not cause unnecessary re-renders.
    const safeInternalFileActionDispatcher = useRefCallbackWithErrorHandling(
        internalFileActionDispatcher,
        'the internal file action requester'
    );
    const setDispatchFileAction = useSetRecoilState(dispatchFileActionState);
    useEffect(() => setDispatchFileAction(() => safeInternalFileActionDispatcher), [
        safeInternalFileActionDispatcher,
        setDispatchFileAction,
    ]);

    // Prepare file action requester (used to request a file action to be dispatched
    // internally)
    const internalFileActionRequester = useInternalFileActionRequester();
    // Recoil state: Put file action requester into Recoil state, in a way that will
    // not cause unnecessary re-renders.
    const safeInternalFileActionRequester = useRefCallbackWithErrorHandling(
        internalFileActionRequester,
        'the internal file action requester'
    );
    const setRequestFileAction = useSetRecoilState(requestFileActionState);
    useEffect(() => setRequestFileAction(() => safeInternalFileActionRequester), [
        safeInternalFileActionRequester,
        setRequestFileAction,
    ]);

    return { internalFileActionDispatcher, internalFileActionRequester };
};

export const useFileActionTrigger = (fileActionId: string) => {
    const requestFileAction = useRecoilValue(requestFileActionState);
    return useCallback(() => requestFileAction(fileActionId), [
        fileActionId,
        requestFileAction,
    ]);
};

export const useFileActionModifiers = (
    fileActionId: string
): { active: boolean; disabled: boolean } => {
    const parentFolder = useRecoilValue(parentFolderState);
    const searchBarVisible = useRecoilValue(searchBarVisibleState);
    const action = useRecoilValue(fileActionDataState(fileActionId));
    const actionSelectionSize = useRecoilValue(
        fileActionSelectedFilesCountState(fileActionId)
    );

    const actionSelectionEmpty = actionSelectionSize === 0;

    return useMemo(() => {
        if (!action) return { active: false, disabled: true };

        const active = action.id === ChonkyActions.ToggleSearch.id && searchBarVisible;
        let disabled: boolean = !!action.requiresSelection && actionSelectionEmpty;

        if (action.id === ChonkyActions.OpenParentFolder.id) {
            // We treat `open_parent_folder` file action as a special case as it
            // requires the parent folder to be present to work...
            disabled = disabled || !FileHelper.isOpenable(parentFolder);
        }

        return { active, disabled };
    }, [action, searchBarVisible, parentFolder, actionSelectionEmpty]);
};