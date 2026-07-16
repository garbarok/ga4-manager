package ga4

import (
	"errors"
	"strings"
)

// ErrAlreadyExists is returned (wrapped) by Create* methods when the GA4 API
// rejects a create with 409 ALREADY_EXISTS. Callers decide whether that is a
// skippable conflict or a failure; it must never be reported as a creation.
var ErrAlreadyExists = errors.New("resource already exists")

// errMsgAlreadyExists is the error message substring returned by the GA4 API
// when a resource already exists. Centralised here so that if the API changes
// its wording only this constant needs updating.
const errMsgAlreadyExists = "already exists"

// errMsgAlreadyExistsGRPC is the gRPC status code string for the same condition.
// The GA4 Admin API may surface either form depending on the transport layer.
const errMsgAlreadyExistsGRPC = "alreadyExists"

// isAlreadyExistsError reports whether err indicates that a GA4 resource
// already exists. It matches both the human-readable message and the gRPC
// status string so that callers are insulated from API message changes.
func isAlreadyExistsError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, errMsgAlreadyExists) || strings.Contains(msg, errMsgAlreadyExistsGRPC)
}
