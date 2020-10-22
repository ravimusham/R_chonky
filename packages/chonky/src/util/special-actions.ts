import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { Nullable } from 'tsdef';

import { reduxActions, RootState } from '../redux/reducers';
import {
    getIsFileSelected,
    getSelectedFiles,
    selectFileActionDispatcher,
    selectParentFolder,
    selectRawFiles,
    selectSelectionSize,
} from '../redux/selectors';
import { useDTE } from '../redux/store';
import {
    SpecialAction,
    SpecialActionData,
    SpecialActionHandlerMap,
    SpecialDragNDropEndAction,
    SpecialDragNDropStartAction,
    SpecialFileKeyboardClickAction,
    SpecialFileMouseClickAction,
    SpecialOpenFolderChainFolderAction,
} from '../types/special-actions.types';
import { ChonkyActions } from './file-actions-definitions';
import { FileHelper } from './file-helper';
import { useInstanceVariable } from './hooks-helpers';
import { Logger } from './logger';

/**
 * Returns a dispatch method meant to be used by child components. This dispatch
 * method is meant for "special" internal actions. It takes a special action, and
 * transforms it into a "file action" that can be handled by the user.
 */
export const useSpecialActionDispatcher = () => {
    // Create the special action handler map
    const specialActionHandlerMap = useSpecialFileActionHandlerMap();

    // Process special actions using the handlers from the map
    const dispatchSpecialAction = useCallback(
        (actionData: SpecialActionData) => {
            Logger.debug(`SPECIAL ACTION REQUEST:`, actionData);
            const { actionId } = actionData;
            const handler = specialActionHandlerMap[actionId];
            if (handler) {
                try {
                    handler(actionData);
                } catch (error) {
                    Logger.error(
                        `Handler for special action "${actionId}" threw an error.`,
                        error
                    );
                }
            } else {
                Logger.error(
                    `Internal components dispatched a "${actionId}" special action, ` +
                        `but no internal handler is available to process it.`
                );
            }
        },
        [specialActionHandlerMap]
    );

    useDTE(reduxActions.setSpecialActionDispatcher, dispatchSpecialAction);
};

export const useSpecialFileActionHandlerMap = () => {
    const store = useStore<RootState>();
    const dispatch = useDispatch();

    // Instance variables based on Recoil state
    const rawFiles = useSelector(selectRawFiles);
    const parentFolderRef = useInstanceVariable(useSelector(selectParentFolder));
    const selectionSizeRef = useInstanceVariable(useSelector(selectSelectionSize));
    const dispatchFileActionRef = useInstanceVariable(
        useSelector(selectFileActionDispatcher)
    );

    // Internal instance variables used by special actions
    const lastClickDisplayIndexRef = useRef<Nullable<number>>(null);
    useEffect(() => {
        // We zero out the last click whenever files update
        // TODO: Improve this mechanism... There must be a better way.
        lastClickDisplayIndexRef.current = null;
    }, [rawFiles]);

    // Define handlers in a map
    const specialActionHandlerMap = useMemo<SpecialActionHandlerMap>(() => {
        return {
            [SpecialAction.MouseClickFile]: (data: SpecialFileMouseClickAction) => {
                if (data.clickType === 'double') {
                    if (FileHelper.isOpenable(data.file)) {
                        dispatchFileActionRef.current({
                            actionId: ChonkyActions.OpenFiles.id,
                            target: data.file,

                            // To simulate Windows Explorer and Nautilus behaviour,
                            // a double click on a file only opens that file even if
                            // there is a selection.
                            files: [data.file],
                        });
                    }
                } else {
                    // We're dealing with a single click
                    if (FileHelper.isSelectable(data.file)) {
                        if (data.ctrlKey) {
                            // Multiple selection
                            dispatch(
                                reduxActions.toggleSelection({
                                    fileId: data.file.id,
                                    exclusive: false,
                                })
                            );
                            lastClickDisplayIndexRef.current = data.fileDisplayIndex;
                        } else if (data.shiftKey) {
                            // Range selection
                            if (typeof lastClickDisplayIndexRef.current === 'number') {
                                // We have the index of the previous click
                                let rangeStart = lastClickDisplayIndexRef.current;
                                let rangeEnd = data.fileDisplayIndex;
                                if (rangeStart > rangeEnd) {
                                    [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
                                }

                                dispatch(
                                    reduxActions.selectRange({ rangeStart, rangeEnd })
                                );
                            } else {
                                // Since we can't do a range selection, do a
                                // multiple selection
                                dispatch(
                                    reduxActions.toggleSelection({
                                        fileId: data.file.id,
                                        exclusive: false,
                                    })
                                );
                                lastClickDisplayIndexRef.current =
                                    data.fileDisplayIndex;
                            }
                        } else {
                            // Exclusive selection
                            dispatch(
                                reduxActions.toggleSelection({
                                    fileId: data.file.id,
                                    exclusive: true,
                                })
                            );
                            lastClickDisplayIndexRef.current = data.fileDisplayIndex;
                        }
                    } else {
                        if (!data.ctrlKey) dispatch(reduxActions.clearSelection());
                        lastClickDisplayIndexRef.current = data.fileDisplayIndex;
                    }
                }
            },
            [SpecialAction.KeyboardClickFile]: (
                data: SpecialFileKeyboardClickAction
            ) => {
                lastClickDisplayIndexRef.current = data.fileDisplayIndex;
                if (data.enterKey) {
                    // We only dispatch the Open Files action here when the selection is
                    // empty. Otherwise, `Enter` key presses are handled by the
                    // hotkey manager for the Open Files action.
                    if (selectionSizeRef.current === 0) {
                        dispatchFileActionRef.current({
                            actionId: ChonkyActions.OpenFiles.id,
                            target: data.file,
                            files: [data.file],
                        });
                    }
                } else if (data.spaceKey && FileHelper.isSelectable(data.file)) {
                    dispatch(
                        reduxActions.toggleSelection({
                            fileId: data.file.id,
                            exclusive: data.ctrlKey,
                        })
                    );
                }
            },
            [SpecialAction.OpenParentFolder]: () => {
                if (FileHelper.isOpenable(parentFolderRef.current)) {
                    dispatchFileActionRef.current({
                        actionId: ChonkyActions.OpenFiles.id,
                        target: parentFolderRef.current,
                        files: [parentFolderRef.current],
                    });
                } else {
                    Logger.warn(
                        `Special action "${SpecialAction.OpenParentFolder}" was ` +
                            `dispatched even though the parent folder is not ` +
                            `openable. This indicates a bug in presentation components.`
                    );
                }
            },
            [SpecialAction.OpenFolderChainFolder]: (
                data: SpecialOpenFolderChainFolderAction
            ) => {
                dispatchFileActionRef.current({
                    actionId: ChonkyActions.OpenFiles.id,
                    target: data.file,
                    files: [data.file],
                });
            },
            [SpecialAction.DragNDropStart]: (data: SpecialDragNDropStartAction) => {
                const file = data.dragSource;
                if (!getIsFileSelected(store.getState(), file)) {
                    dispatch(reduxActions.clearSelection());
                    if (FileHelper.isSelectable(file)) {
                        reduxActions.selectFiles({
                            fileIds: [file.id],
                            reset: true,
                        });
                    }
                }
            },
            [SpecialAction.DragNDropEnd]: (data: SpecialDragNDropEndAction) => {
                if (getIsFileSelected(store.getState(), data.dropTarget)) {
                    // Can't drop a selection into itself
                    return;
                }

                const selectedFiles = getSelectedFiles(
                    store.getState(),
                    FileHelper.isDraggable
                );
                const droppedFiles =
                    selectedFiles.length > 0 ? selectedFiles : [data.dragSource];
                dispatchFileActionRef.current({
                    actionId:
                        data.dropEffect === 'copy'
                            ? ChonkyActions.DuplicateFilesTo.id
                            : ChonkyActions.MoveFilesTo.id,
                    target: data.dropTarget,
                    files: droppedFiles,
                });
            },
        } as SpecialActionHandlerMap;
    }, [store, dispatch, parentFolderRef, selectionSizeRef, dispatchFileActionRef]);
    return specialActionHandlerMap;
};