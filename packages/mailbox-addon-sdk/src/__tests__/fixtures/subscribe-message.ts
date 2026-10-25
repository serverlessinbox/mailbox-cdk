import {
  FieldDescriptorProto_Label, FieldDescriptorProto_Type, FileDescriptorProtoSchema, FileDescriptorSetSchema,
} from '@bufbuild/protobuf/wkt';
import { create, createFileRegistry }                                                       from '@bufbuild/protobuf';
import type { DescMessage }                                                                 from '@bufbuild/protobuf';

/*
 * A protobuf message built at test time from a descriptor, so the tests need no generated code. It has the shape
 * the tests use: a string `id`, a string `account_id` (JSON name `accountId`) and a repeated string `types`.
 */

const file = create(FileDescriptorProtoSchema, {
  name:        'fixture.proto',
  package:     'fixture.v1',
  syntax:      'proto3',
  messageType: [
    {
      name:  'Subscribe',
      field: [
        { name: 'id', number: 1, type: FieldDescriptorProto_Type.STRING, label: FieldDescriptorProto_Label.OPTIONAL, jsonName: 'id' },
        { name: 'account_id', number: 2, type: FieldDescriptorProto_Type.STRING, label: FieldDescriptorProto_Label.OPTIONAL, jsonName: 'accountId' },
        { name: 'types', number: 3, type: FieldDescriptorProto_Type.STRING, label: FieldDescriptorProto_Label.REPEATED, jsonName: 'types' },
      ],
    },
  ],
});

const message = createFileRegistry(create(FileDescriptorSetSchema, { file: [file] })).getMessage('fixture.v1.Subscribe');

if (message === undefined) {
  throw new Error('The fixture descriptor does not define fixture.v1.Subscribe');
}

export const SubscribeSchema: DescMessage = message;
