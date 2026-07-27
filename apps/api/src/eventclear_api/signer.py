from __future__ import annotations

from typing import TYPE_CHECKING

from eth_account import Account
from eth_account.messages import SignableMessage
from eth_keys.datatypes import Signature
from eth_utils import keccak

if TYPE_CHECKING:
    from .settings import Settings

SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


def typed_data_digest(message: SignableMessage) -> bytes:
    return keccak(b"\x19" + message.version + message.header + message.body)


def _decode_der_signature(value: bytes) -> tuple[int, int]:
    if len(value) < 8 or value[0] != 0x30:
        raise ValueError("INVALID_KMS_DER_SIGNATURE")
    offset = 2
    if value[1] & 0x80:
        length_bytes = value[1] & 0x7F
        offset = 2 + length_bytes
    if value[offset] != 0x02:
        raise ValueError("INVALID_KMS_DER_SIGNATURE")
    r_length = value[offset + 1]
    r = int.from_bytes(value[offset + 2 : offset + 2 + r_length], "big")
    offset += 2 + r_length
    if value[offset] != 0x02:
        raise ValueError("INVALID_KMS_DER_SIGNATURE")
    s_length = value[offset + 1]
    s = int.from_bytes(value[offset + 2 : offset + 2 + s_length], "big")
    return r, s


def _recoverable_signature(digest: bytes, r: int, s: int, expected_address: str) -> bytes:
    if s > SECP256K1_ORDER // 2:
        s = SECP256K1_ORDER - s
    for recovery_id in (0, 1):
        candidate = Signature(vrs=(recovery_id, r, s))
        recovered = candidate.recover_public_key_from_msg_hash(digest).to_checksum_address()
        if recovered.lower() == expected_address.lower():
            return r.to_bytes(32, "big") + s.to_bytes(32, "big") + bytes([recovery_id + 27])
    raise ValueError("KMS_SIGNATURE_ADDRESS_MISMATCH")


def sign_typed_data(message: SignableMessage, settings: Settings) -> bytes:
    if settings.signer_backend == "local":
        return Account.sign_message(message, private_key=settings.signer_key).signature

    import boto3

    digest = typed_data_digest(message)
    kms = boto3.client("kms", region_name=settings.signer_kms_region)
    response = kms.sign(
        KeyId=settings.signer_kms_key_id,
        Message=digest,
        MessageType="DIGEST",
        SigningAlgorithm="ECDSA_SHA_256",
    )
    r, s = _decode_der_signature(bytes(response["Signature"]))
    return _recoverable_signature(digest, r, s, settings.signer_address)
